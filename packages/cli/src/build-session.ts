/**
 * 会话装配：把 args + provider + tools 组装成一个 AgentSession。
 * 供各模式（print/interactive）复用（架构文档 §4.2.1）。
 * M2：-c 续最近会话，-r 浏览并选择恢复（SessionManager，见 原理-session.md §3）。
 */

import process from 'node:process';
import readline from 'node:readline/promises';
import { OpenAIClient, resolveApiKey, resolveBaseUrl } from '@dscode/ai';
import { AgentSessionRuntime, SessionManager, createBuiltinRegistry, type AgentSession } from '@dscode/core';
import type { CliArgs } from './args.js';

export interface BuildSessionResult {
  session: AgentSession;
  /** 无可用 key 时的错误提示（SC-1.1：无配置时引导输入） */
  authError?: string;
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
  const resolved = await resolveApiKey({ cliApiKey: args.apiKey });
  if (!resolved?.key) {
    return {
      session: null as unknown as AgentSession,
      authError: '未找到 DeepSeek API key。请用 --api-key 指定，或运行 dscode 交互模式首次引导，或设置 DSCODE_API_KEY 环境变量。',
    };
  }

  const client = new OpenAIClient({
    baseUrl: resolveBaseUrl(),
    apiKey: resolved.key,
  });

  const sessionId = await resolveSessionId(args);

  const session = AgentSessionRuntime.create({
    cwd: process.cwd(),
    tools: createBuiltinRegistry(),
    client,
    model: args.model,
    sessionId,
  });
  await session.prepare();
  return { session };
}

/** 依赖树里 core 的 tools 注册表构建（显式引用避免摇树） */
export function buildTools() {
  return createBuiltinRegistry();
}
