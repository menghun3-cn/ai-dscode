/**
 * 会话装配：把 args + providers + tools 组装成一个 AgentSession。
 * 供各模式（print/interactive）复用（架构文档 §4.2.1）。
 * M2：-c 续最近会话，-r 浏览并选择恢复。
 * M3：多 provider——按 --provider 选初始 provider，clientFactory 支持 /model 跨 provider 热切换。
 */

import process from 'node:process';
import readline from 'node:readline/promises';
import {
  createDefaultProviders,
  createClientFor,
  resolveApiKey,
  resolveBaseUrl,
  resolveProviderApiKey,
  syncModelsStore,
  type Provider,
} from '@dscode/ai';
import {
  AgentSessionRuntime,
  EventBus,
  ExtensionManager,
  McpClient,
  PermissionEngine,
  SessionManager,
  createBuiltinRegistry,
  registerMcpTools,
  type AgentSession,
  type ChatStreamer,
} from '@dscode/core';
import type { CliArgs } from './args.js';

export interface BuildSessionResult {
  session: AgentSession;
  /** M4：扩展管理器（/reload /extensions 用） */
  extManager?: ExtensionManager;
  /** 无可用 key 时的错误提示（SC-1.1：无配置时引导输入） */
  authError?: string;
}

/** 全部可用 provider（DeepSeek 优先） */
export const PROVIDERS = createDefaultProviders();

/** 按 id 找 provider；找不到回退第一个 */
export function findProvider(id: string): Provider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;
}

/** 按模型 id 找所属 provider（/model 跨 provider 切换用）；找不到回退第一个 */
export function findProviderForModel(modelId: string): Provider {
  return PROVIDERS.find((p) => p.models.some((m) => m.id === modelId)) ?? PROVIDERS[0]!;
}

/** 解析某 provider 的 key：--api-key > auth.json 对应条目 > ${PROVIDER}_API_KEY（deepseek 走原有逻辑） */
async function resolveKeyFor(provider: Provider, cliApiKey?: string): Promise<string | undefined> {
  if (cliApiKey) return cliApiKey;
  if (provider.id === 'deepseek') return (await resolveApiKey())?.key;
  return resolveProviderApiKey(provider.id);
}

/** 按 provider 建 client；deepseek 尊重 DSCODE_BASE_URL / DSAPI_BASE_URL 覆盖 */
function clientFor(provider: Provider, apiKey: string): ChatStreamer {
  const effective = provider.id === 'deepseek' ? { ...provider, baseUrl: resolveBaseUrl() } : provider;
  return createClientFor(effective, apiKey) as ChatStreamer;
}

/** 按 args 解析要恢复的 sessionId：-c 最近 / -r 列表选择；无则 undefined（新建） */
export async function resolveSessionId(args: CliArgs): Promise<string | undefined> {
  const mgr = new SessionManager(process.cwd());
  if (args.cont) {
    return (await mgr.latestId()) ?? undefined;
  }
  if (args.resume) {
    const list = await mgr.list();
    if (list.length === 0) return undefined;
    if (list.length === 1 || !process.stdin.isTTY) return list[0]!.id;
    // 交互选择（仅 TTY）
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
      const shown = list
        .map((m, i) => `  ${i + 1}. ${m.name ? `「${m.name}」` : m.id.slice(0, 8)}（${m.entries} 条，${new Date(m.mtime).toLocaleString()}）`)
        .join('\n');
      process.stderr.write(`当前目录会话（${list.length} 个）:\n${shown}\n选择编号（回车=最近）: `);
      const answer = (await rl.question('')).trim();
      const idx = Number(answer) - 1;
      return list[idx]?.id ?? list[0]!.id;
    } finally {
      rl.close();
    }
  }
  return undefined;
}

/** 装配会话；鉴权失败时返回 authError 而非抛异常（由模式决定如何引导） */
export async function buildSession(args: CliArgs): Promise<BuildSessionResult> {
  // M3 P1：远端模型目录——拉取更新 + 合并缓存（离线可用），失败静默用内置目录
  await syncModelsStore(PROVIDERS);

  const initialProvider = findProvider(args.provider);
  const initialKey = await resolveKeyFor(initialProvider, args.apiKey);
  if (!initialKey) {
    const hint =
      initialProvider.id === 'deepseek'
        ? '请用 --api-key 指定，或运行 dscode 交互模式首次引导，或设置 DSCODE_API_KEY 环境变量。'
        : `请设置 ${initialProvider.id.toUpperCase()}_API_KEY 环境变量（或 --api-key）。`;
    return {
      session: null as unknown as AgentSession,
      authError: `未找到 ${initialProvider.id} 的 API key。${hint}`,
    };
  }

  // 预解析全部 provider 的 key，供 clientFactory 跨 provider 热切换
  const keys = new Map<string, string>();
  for (const p of PROVIDERS) {
    const k = await resolveKeyFor(p, args.apiKey);
    if (k) keys.set(p.id, k);
  }

  const client = clientFor(initialProvider, initialKey);
  const sessionId = await resolveSessionId(args);

  // M4：装配扩展（事件总线 + 加载器 + 项目信任提示）
  const bus = new EventBus();
  const extManager = new ExtensionManager({
    cwd: process.cwd(),
    bus,
    trustPrompt: async (cwd) => {
      if (!process.stdin.isTTY) return false;
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = await rl.question(`此项目（${cwd}）有扩展，是否信任并加载？(y/N) `);
        return /^y/i.test(answer.trim());
      } finally {
        rl.close();
      }
    },
  });
  await extManager.loadAll();

  // M5/M5-S5：权限引擎（审批模式分级 + 危险命令二次确认；非 TTY 无交互时默认拒绝）
  const permission = new PermissionEngine({
    mode: args.approval,
    confirm: async (message) => {
      if (!process.stdin.isTTY) return false;
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = await rl.question(`${message} `);
        return /^y/i.test(answer.trim());
      } finally {
        rl.close();
      }
    },
  });

  // M7：MCP servers（DSCODE_MCP_SERVERS env，JSON { name: { command, args } }）
  // 连接失败不阻塞启动（日志提示，见 原理-mcp.md §5 生命周期）
  const registry = createBuiltinRegistry();
  const mcpRaw = process.env['DSCODE_MCP_SERVERS'];
  if (mcpRaw) {
    try {
      const servers = JSON.parse(mcpRaw) as Record<string, { command: string; args?: string[] }>;
      for (const [name, cfg] of Object.entries(servers)) {
        try {
          const client = new McpClient(cfg.command, cfg.args ?? []);
          await client.connect();
          const n = await registerMcpTools(registry, client, name);
          process.stderr.write(`[mcp] 已连接 ${name}（${n} 个工具）\n`);
        } catch (err) {
          process.stderr.write(`[mcp] ${name} 连接失败: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      }
    } catch {
      process.stderr.write('[mcp] DSCODE_MCP_SERVERS 不是合法 JSON，已跳过\n');
    }
  }

  const session = AgentSessionRuntime.create({
    cwd: process.cwd(),
    tools: registry,
    client,
    bus,
    permission,
    extTools: () => extManager.getTools(), // supplier：/reload 后新工具立即可用
    // /model 切换时：按目标模型所属 provider 换 client
    clientFactory: (modelId: string) => {
      const p = findProviderForModel(modelId);
      const key = keys.get(p.id);
      return key ? clientFor(p, key) : undefined;
    },
    model: args.model,
    sessionId,
  });
  await session.prepare();
  return { session, extManager };
}

/** 依赖树里 core 的 tools 注册表构建（显式引用避免摇树） */
export function buildTools() {
  return createBuiltinRegistry();
}
