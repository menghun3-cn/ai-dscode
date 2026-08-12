/**
 * interactive TUI（重构 v2：全屏差分渲染，对齐 pi 架构——组件 render→lines、模型驱动帧、alternate screen）。
 * 渲染完全由本层拥有（readline 仅做输入编辑，输出到空 sink）——根治"增量 ANSI 修补 + readline 光标冲突"反复回归。
 * 布局纯逻辑在 tui-render.ts（纯函数，可完整单测）。
 */

import readline, { type Key } from 'node:readline';
import process from 'node:process';
import { Writable } from 'node:stream';
import { readdirSync } from 'node:fs';
import type { AgentEvent, AgentSession, ExtensionManager } from '@dscode/core';
import { createDebugLogger } from '@dscode/core';
import { handleSlash, commandCompletions, type SlashCommandContext } from './commands.js';
import { expandInput } from './expand.js';
import { friendlyError } from './errors.js';
import { DSCCODE_VERSION } from './args.js';
import { PROVIDERS } from './build-session.js';
import { renderLayout, visibleLen, fixedRowsFor, welcomeBox, type TuiModel } from './tui-render.js';
import { updateMenuForLine, menuStep, menuClose, menuPick } from './tui-controller.js';

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cost: number;
  requests: number;
}

/** 模型单价（每百万 token USD）：从全部 provider 模型目录取（M3，SC-3.3） */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

let MODEL_COST: Record<string, Price> = {};

/** 重建价格表（/models-update 合并远端目录后刷新） */
function rebuildModelCost(): void {
  MODEL_COST = Object.fromEntries(
    PROVIDERS.flatMap((p) => p.models).map((m) => [m.id, { input: m.cost.input, output: m.cost.output, cacheRead: m.cost.cacheRead }]),
  );
}
rebuildModelCost();

/** reasoning 展示模式（/thinking 切换，SC-3.2）：stream=流式灰色 / fold=折叠一行 / off=隐藏；默认 stream */
let thinkingMode: 'stream' | 'fold' | 'off' = 'stream';

/** 思考折叠去重状态：同一段思考只显示一次 [思考中…]，正文前换行分隔 */
let reasoningShown = false;

/** 流式思考已输出的标记：stream 模式下思考→正文前需换行分隔（根治"思考与正文连一行"） */
let reasoningStreamed = false;

/** 流式代码块围栏状态（跨 chunk 维护） */
let codeFenceOpen = false;

/** 重置代码块围栏状态（每轮 agent 运行前调用） */
export function resetCodeFence(): void {
  codeFenceOpen = false;
  reasoningShown = false;
  reasoningStreamed = false;
}

/** 流式代码块围栏着色（返回 ANSI 渲染串） */
export function renderStreamingText(text: string): string {
  let out = '';
  let cursor = 0;
  for (;;) {
    const idx = text.indexOf('```', cursor);
    if (idx === -1) {
      const tail = text.slice(cursor);
      out += codeFenceOpen ? `\x1b[36m${tail}\x1b[0m` : tail;
      break;
    }
    const before = text.slice(cursor, idx);
    out += codeFenceOpen ? `\x1b[36m${before}\x1b[0m` : before;
    if (!codeFenceOpen) {
      const after = text.slice(idx + 3);
      const langEnd = after.indexOf('\n');
      const lang = (langEnd === -1 ? after : after.slice(0, langEnd)).trim();
      out += `\n\x1b[36m\`\`\`${lang}\x1b[0m\n`;
      codeFenceOpen = true;
      cursor = idx + 3 + (langEnd === -1 ? after.length : langEnd + 1);
    } else {
      out += `\n\x1b[36m\`\`\`\x1b[0m\n`;
      codeFenceOpen = false;
      cursor = idx + 3;
    }
  }
  return out;
}

/** 渲染一个 agent 事件为文本串 */
export function renderEventText(ev: AgentEvent): string {
  switch (ev.type) {
    case 'message_update':
      return ev.content;
    case 'reasoning_update':
      if (thinkingMode === 'off') return '';
      if (thinkingMode === 'fold') {
        if (reasoningShown) return '';
        reasoningShown = true;
        return '\x1b[90m[思考中…]\x1b[0m';
      }
      reasoningStreamed = true; // stream 模式：思考已流式输出，正文前需换行
      return `\x1b[90m${ev.content}\x1b[0m`;
    case 'tool_call':
      try {
        const args = JSON.parse(ev.args) as Record<string, unknown>;
        return `\n\x1b[36m⚙ ${ev.toolName}\x1b[0m ${JSON.stringify(args)}\n`;
      } catch {
        return `\n\x1b[36m⚙ ${ev.toolName}\x1b[0m ${ev.args}\n`;
      }
    case 'tool_result':
      if (ev.isError) return `\x1b[31m✗ ${ev.output}\x1b[0m\n`;
      return '';
    default:
      return '';
  }
}

/** 渲染一个 agent 事件到 stdout（兼容测试与外部调用） */
export function renderEvent(ev: AgentEvent): void {
  process.stdout.write(renderEventText(ev));
}

export function costText(model: string, usage: UsageStats): string {
  const cost = MODEL_COST[model];
  const input = cost ? (usage.promptTokens / 1_000_000) * cost.input : 0;
  const output = cost ? (usage.completionTokens / 1_000_000) * cost.output : 0;
  const cache = cost ? (usage.cacheReadTokens / 1_000_000) * cost.cacheRead : 0;
  const total = input + output + cache;
  return `模型 ${model} · input ${usage.promptTokens} tok · output ${usage.completionTokens} tok · cache ${usage.cacheReadTokens} tok · 预估成本 $${total.toFixed(4)}`;
}

/** token 友好格式化：1.2K / 518.8K / 1M / 1.2M（整数省略小数） */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${Number.isInteger(v) ? v : v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${Number.isInteger(v) ? v : v.toFixed(1)}K`;
  }
  return `${n}`;
}

/** 秒数友好格式化：5s / 1m 27s */
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** 底部状态栏文本（兼容旧测试） */
export function statusText(opts: {
  model: string;
  cwd: string;
  usedTokens: number;
  contextWindow: number;
  name?: string;
  planActive?: boolean;
  busy?: boolean;
}): string {
  const pct = opts.contextWindow > 0 ? Math.round((opts.usedTokens / opts.contextWindow) * 100) : 0;
  const parts = [
    opts.busy ? '⏳' : '',
    opts.planActive ? '[plan]' : '',
    opts.name ? `「${opts.name}」` : '',
    opts.model,
    opts.cwd,
    `${fmtTokens(opts.usedTokens)}/${fmtTokens(opts.contextWindow)} tok (${pct}%)`,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** 路径截短：过长时保留末尾（状态行用） */
export function shortenPath(cwd: string, maxLen = 34): string {
  if (cwd.length <= maxLen) return cwd;
  return `…${cwd.slice(-(maxLen - 1))}`;
}

/** 上下文进度条 + 已用/剩余（ASCII 兼容字符 + 按占比着色） */
export function contextBar(usedTokens: number, contextWindow: number): string {
  if (contextWindow <= 0) return '';
  const pct = Math.min(100, Math.round((usedTokens / contextWindow) * 100));
  const filled = Math.round((pct / 100) * 10);
  const bar = `[${'#'.repeat(filled)}${'-'.repeat(10 - filled)}]`;
  const remaining = Math.max(0, contextWindow - usedTokens);
  const color = pct >= 80 ? '\x1b[31m' : pct >= 60 ? '\x1b[33m' : '\x1b[32m';
  return `${color}${bar} ${fmtTokens(usedTokens)}/${fmtTokens(contextWindow)} (${pct}% · 剩 ${fmtTokens(remaining)})\x1b[0m`;
}

/** 增强状态行（分色） */
export function statusBarText(opts: {
  model: string;
  cwd: string;
  usedTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  requests: number;
  contextWindow: number;
  cols?: number;
  name?: string;
  planActive?: boolean;
  busy?: boolean;
}): string {
  const used = opts.usedTokens + opts.completionTokens;
  const pct = opts.contextWindow > 0 ? Math.min(100, Math.round((used / opts.contextWindow) * 100)) : 0;
  const leftParts = [
    opts.busy ? '\x1b[33m⏳\x1b[0m' : '',
    opts.planActive ? '\x1b[33m[plan]\x1b[0m' : '',
    opts.name ? `\x1b[35m「${opts.name}」\x1b[0m` : '',
    `\x1b[90m${shortenPath(opts.cwd)}\x1b[0m`,
    `↑${fmtTokens(opts.usedTokens)} ↓${fmtTokens(opts.completionTokens)}`,
    `R${opts.requests} CH${fmtTokens(opts.cacheReadTokens)}`,
    `\x1b[36m${fmtTokens(used)}/${fmtTokens(opts.contextWindow)} (${pct}%)\x1b[0m`,
  ].filter(Boolean).join(' ');
  const right = `\x1b[32m${opts.model}\x1b[0m`;
  const cols = opts.cols ?? 80;
  const pad = Math.max(1, cols - visibleLen(leftParts) - visibleLen(right) - 1);
  return `${leftParts}${' '.repeat(pad)}${right}`;
}

/** 顶部标题栏文本（保留导出兼容；标题栏已按用户要求移除，仅测试引用） */
export function titleBarText(opts: { name?: string; planActive?: boolean; busy?: boolean }): string {
  const parts = [
    'dscode',
    opts.name ? `「${opts.name}」` : '',
    opts.planActive ? '\x1b[33m[plan]\x1b[0m' : '',
    opts.busy ? '\x1b[33m⏳\x1b[0m' : '',
  ].filter(Boolean);
  return `\x1b[36m${parts.join(' · ')}\x1b[0m`;
}

/** 启动 ASCII logo（block 字体，对齐 Claude Code 欢迎布局） */
const DSCCODE_LOGO = [
  '██████╗ ███████╗ ██████╗ ██████╗ ██████╗ ███████╗',
  '██╔══██╗██╔════╝██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '██║  ██║███████╗██║     ██║   ██║██║  ██║█████╗  ',
  '██║  ██║╚════██║██║     ██║   ██║██║  ██║██╔══╝  ',
  '██████╔╝███████║╚██████╗╚██████╔╝██████╔╝███████╗',
  '╚═════╝ ╚══════╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
].join('\n');

/** 终端行数：DSCODE_ROWS env 覆盖 > process.stdout 探测 > 默认 24 */
export function ttyRows(): number {
  const env = Number(process.env['DSCODE_ROWS']);
  if (Number.isFinite(env) && env > 0) return env;
  return process.stdout.rows || 24;
}

/** 终端列数：DSCODE_COLS env 覆盖 > process.stdout 探测 > 默认 80 */
export function ttyCols(): number {
  const env = Number(process.env['DSCODE_COLS']);
  if (Number.isFinite(env) && env > 0) return env;
  return process.stdout.columns || 80;
}

/** 粘贴折叠判定：窗口内连续非 slash 行视为同批粘贴（防逐行误执行） */
export function shouldMergePaste(input: string, lastLineAt: number, now: number, windowMs: number): boolean {
  return now - lastLineAt <= windowMs && !input.startsWith('/');
}

export async function runInteractive(session: AgentSession, extManager?: ExtensionManager, approval: string = 'ask'): Promise<number> {
  // 终端信息启动时缓存一次（readline terminal 模式后查询可能阻塞，见启动挂起修复）
  const TTY = Boolean(process.stdout.isTTY);
  const ROWS = ttyRows();
  const COLS = ttyCols();

  // ---- 模型 + readline（输出到空 sink：readline 只做输入编辑，渲染完全由本层拥有） ----
  const model: TuiModel = { outputLines: [], outputScroll: 0, input: '', inputCursor: 0, menu: null, status: '', runStatus: '', busy: false };
  const nullOut = new Writable({
    write(_chunk: unknown, _enc: unknown, cb: () => void): void {
      cb();
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: nullOut as unknown as NodeJS.WritableStream,
    terminal: true,
    prompt: '',
  });
  const rlAny = rl as unknown as { _ttyWrite: (s: string, key: Key) => void; line: string; cursor: number };

  let modelId = session.model;
  let running = false;
  const usage: UsageStats = { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cost: 0, requests: 0 };
  let availableModels = PROVIDERS.flatMap((p) => p.models.map((m) => m.id));
  let allModelDefs = PROVIDERS.flatMap((p) => p.models);
  const refreshModelLists = (): void => {
    availableModels = PROVIDERS.flatMap((p) => p.models.map((m) => m.id));
    allModelDefs = PROVIDERS.flatMap((p) => p.models);
  };
  const contextWindowOf = (id: string): number => allModelDefs.find((m) => m.id === id)?.contextWindow ?? 65536;
  let history: string[] = [];
  let exitCode = 0;

  const setModelId = (id: string): void => {
    modelId = id;
    session.setModel(id);
  };

  // ---- 渲染（模型 → 全帧 → alternate screen） ----
  /** 输入框上方固定运行状态行文本（运行中实时：耗时 + token 累计） */
  const runningStatusText = (elapsedMs: number): string =>
    `\x1b[90mRunning (${fmtDuration(elapsedMs)} · ↑ ${fmtTokens(usage.promptTokens + usage.completionTokens)} tokens)\x1b[0m`;

  const setStatus = (): void => {
    const used = usage.promptTokens + usage.completionTokens;
    const window = contextWindowOf(modelId);
    const pct = window > 0 ? Math.min(100, Math.round((used / window) * 100)) : 0;
    const leftParts = [
      running ? '\x1b[33m⏳\x1b[0m' : '',
      session.plan.isActive ? '\x1b[33m[plan]\x1b[0m' : '',
      session.name ? `\x1b[35m「${session.name}」\x1b[0m` : '',
      `\x1b[90m${shortenPath(session.cwd)}\x1b[0m`,
      `↑${fmtTokens(usage.promptTokens)} ↓${fmtTokens(usage.completionTokens)}`,
      `R${usage.requests} CH${fmtTokens(usage.cacheReadTokens)}`,
      `\x1b[36m${fmtTokens(used)}/${fmtTokens(window)} (${pct}%)\x1b[0m`,
    ].filter(Boolean).join(' ');
    const right = `\x1b[32m${modelId}\x1b[0m`;
    const pad = Math.max(1, COLS - visibleLen(leftParts) - visibleLen(right) - 1);
    model.status = `${leftParts}${' '.repeat(pad)}${right}`;
  };

  /** 渲染完整帧（差分：对比上一帧只重写变更行，对齐 pi 差分渲染——修复流式闪烁） */
  let prevFrame: ReturnType<typeof renderLayout> | null = null;
  let renderScheduled = false;
  const doRender = (): void => {
    renderScheduled = false;
    if (!TTY) return;
    try {
      const frame = renderLayout(model, COLS, ROWS);
      process.stdout.write('\x1b[?25l'); // 隐藏光标（避免闪烁）
      if (prevFrame) {
        const prev = prevFrame.lines;
        const cur = frame.lines;
        const max = Math.max(prev.length, cur.length);
        for (let i = 0; i < max; i++) {
          if (prev[i] !== cur[i]) {
            // 先清后写：\x1b[K 在内容前清除本行（含上一行超宽换行的残留碎片——"重复显示"根因）
            process.stdout.write(`\x1b[${i + 1};1H\x1b[K${cur[i] ?? ''}`);
          }
        }
      } else {
        process.stdout.write('\x1b[1;1H'); // 首帧全量
        for (let i = 0; i < frame.lines.length; i++) {
          // 末行不加 \r\n：避免写到最后一行时触发终端滚动，导致帧内容上移 1 行（差分残留/重复显示根因）
          const last = i === frame.lines.length - 1;
          process.stdout.write(`\x1b[K${frame.lines[i]!}${last ? '' : '\r\n'}`);
        }
      }
      prevFrame = frame;
      process.stdout.write(`\x1b[${frame.cursorRow + 1};${frame.cursorCol + 1}H\x1b[?25h`); // 光标到输入行
    } catch {
      // 渲染异常不崩进程（模型状态边角情况）：跳过本帧，下帧重试
    }
  };
  /** 批量渲染：同 tick 多次变更合并为一次（流式 chunk 高频调用时显著减少 I/O） */
  const render = (): void => {
    if (renderScheduled) return;
    renderScheduled = true;
    process.nextTick(doRender);
  };

  /** 输出视口滚动（+ = 向上回看，- = 返回底部）；对齐 pi：滚轮经 alternate-scroll 翻译为 ↑↓ 后调用 */
  const scrollOutput = (delta: number): void => {
    const outputRows = Math.max(1, ROWS - fixedRowsFor(model.input));
    const max = Math.max(0, model.outputLines.length - outputRows);
    model.outputScroll = Math.max(0, Math.min((model.outputScroll ?? 0) + delta, max));
    render();
  };

  /** 追加"新行"输出（离散输出：回显/结果/提示/错误——各占新行） */
  const appendLine = (text: string): void => {
    for (const seg of text.split('\n')) model.outputLines.push(seg);
    setStatus();
    render();
  };

  /** 追加"内联"输出（流式 chunk：续接到最后一行） */
  const appendInline = (text: string): void => {
    const lines = text.split('\n');
    if (model.outputLines.length > 0) {
      model.outputLines[model.outputLines.length - 1] += lines[0] ?? '';
    } else {
      model.outputLines.push(lines[0] ?? '');
    }
    for (let i = 1; i < lines.length; i++) model.outputLines.push(lines[i]!);
    setStatus();
    render();
  };

  /** 输入行模型同步（readline 空 sink 下状态仍更新，渲染由我们做） */
  const syncInput = (): void => {
    model.input = rlAny.line ?? '';
    model.inputCursor = rlAny.cursor ?? 0;
  };

  /** @文件 补全（输入行 @前缀匹配 cwd） */
  const fileCompletions = (line: string): string[] => {
    const m = line.match(/@([^\s@]*)$/);
    if (!m) return [];
    const prefix = m[1]!;
    try {
      return readdirSync(session.cwd, { withFileTypes: true })
        .filter((e) => e.name.startsWith(prefix))
        .slice(0, 20)
        .map((e) => line.replace(/@[^\s@]*$/, `@${e.name}`));
    } catch {
      return [];
    }
  };

  const slashCtx: SlashCommandContext = {
    get model() {
      return modelId;
    },
    availableModels,
    setModel: setModelId,
    clearMessages: () => {
      session.messages.length = 0;
    },
    costText: () => costText(modelId, usage),
    get thinkingMode() {
      return thinkingMode;
    },
    setThinkingMode: (mode) => {
      thinkingMode = mode;
    },
    updateModelsStore: async () => {
      const { updateModelsStore, mergeModels, modelsStoreUrl } = await import('@dscode/ai');
      const url = modelsStoreUrl();
      if (!url) return '未配置 DSCODE_MODELS_URL，跳过（仅用内置目录）。';
      try {
        const store = await updateModelsStore(url);
        mergeModels(PROVIDERS, store);
        refreshModelLists();
        rebuildModelCost();
        return `已拉取并合并模型目录（${Object.keys(store).length} 个 provider，共 ${availableModels.length} 个模型）。`;
      } catch (err) {
        return `模型目录拉取失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    extensions: {
      list: () => {
        if (!extManager) return '未装配扩展管理器';
        const apis = extManager.getApis();
        const errors = extManager.getErrors();
        const lines = apis.length > 0 ? apis.map((a) => `  ${a.getCommands().length > 0 ? `⚙ ` : ''}已加载（工具 ${a.getTools().length} · 命令 ${a.getCommands().length}）`) : [];
        const errLines = errors.map((e) => `  ✗ ${e.file}: ${e.message}`);
        return `扩展已加载 ${apis.length} 个${lines.length > 0 ? `:\n${lines.join('\n')}` : ''}${errLines.length > 0 ? `\n加载错误:\n${errLines.join('\n')}` : ''}`;
      },
      reload: async () => {
        if (!extManager) return '未装配扩展管理器';
        await extManager.loadAll();
        const apis = extManager.getApis();
        const errors = extManager.getErrors();
        const toolCount = extManager.getTools().length;
        const cmdCount = extManager.getCommands().length;
        const errText = errors.length > 0 ? `；${errors.length} 个加载错误（/extensions 查看）` : '';
        return `已热重载扩展：${apis.length} 个加载，工具 ${toolCount} · 命令 ${cmdCount}${errText}`;
      },
    },
    skills: {
      apply: async (name) => {
        const ok = await session.applySkill(name);
        return ok ? `已加载 skill: ${name}` : `未找到 skill: ${name}（/skill 查看可用列表）`;
      },
      list: async () => {
        const names = await session.listSkills();
        return names.length > 0 ? `可用 skills:\n${names.map((n) => `  ${n}`).join('\n')}` : '暂无 skills（放 ~/.dscode/skills/*.md 或 .dscode/skills/*.md）';
      },
    },
    plan: {
      enter: () => {
        session.plan.enter();
        return '已进入 Plan 模式（只读：write/edit 等写工具被拒）。产出步骤清单后 /accept-plan 落地。';
      },
      accept: () => {
        session.plan.accept();
        return '已接受计划，进入执行阶段（写工具放行）。';
      },
      setSteps: (titles) => {
        session.plan.setSteps(titles);
        const steps = session.plan.getSteps();
        return `计划步骤已设置（${steps.length} 步）:\n${steps.map((s) => `  ${s.id} [${s.status}] ${s.title}`).join('\n')}`;
      },
    },
    permission: {
      allow: async (rule) => {
        const { addPermissionRule } = await import('@dscode/core');
        await addPermissionRule('allow', rule);
        return `已允许并持久化: ${rule}（下次该操作直接放行）`;
      },
      deny: async (rule) => {
        const { addPermissionRule } = await import('@dscode/core');
        await addPermissionRule('deny', rule);
        return `已拒绝并持久化: ${rule}（下次该操作直接拦截）`;
      },
    },
    compact: async (extra) => session.compact(extra),
    session: {
      id: session.sessionId,
      get activeBranch() {
        return session.activeBranch;
      },
      jumpTo: (entryId) => session.jumpTo(entryId),
      switchBranch: (entryId) => session.switchBranch(entryId),
      forkFrom: (entryId) => session.forkFrom(entryId),
      clone: () => session.clone(),
      label: (name) => session.label(name),
      exportMarkdown: async (html = false) => {
        const { promises: fs } = await import('node:fs');
        const path = await import('node:path');
        const { renderSessionMarkdown, renderSessionHtml } = await import('./export.js');
        const branch = session.activeBranch;
        const content = html ? renderSessionHtml({ sessionId: session.sessionId, branch }) : renderSessionMarkdown({ sessionId: session.sessionId, branch });
        const file = path.join(session.cwd, html ? `dscode-session-${session.sessionId.slice(0, 8)}.html` : `dscode-session-${session.sessionId.slice(0, 8)}.md`);
        await fs.writeFile(file, content, 'utf8');
        return file;
      },
      listSessions: async () => {
        const { SessionManager } = await import('@dscode/core');
        return new SessionManager(session.cwd).list();
      },
    },
  };

  // ---- 键盘拦截（readline _ttyWrite）：菜单/快捷键 → 更新模型 → render ----
  const origTtyWrite = rlAny._ttyWrite.bind(rl);
  rlAny._ttyWrite = (s: string | undefined, key: Key | undefined) => {
    // readline（Bun 实现）部分路径会传 undefined（鼠标序列分片/特殊按键）：防御，杜绝崩溃
    const sStr = typeof s === 'string' ? s : '';
    if (key === undefined || key === null) {
      origTtyWrite(sStr, key as never); // 非按键事件：交还原版处理
      return;
    }
    if (key.ctrl && key.name === 'r') {
      const candidates = history.slice(-15).reverse();
      if (candidates.length > 0) {
        model.menu = { candidates, index: 0 };
        render();
      }
      return;
    }
    if (key.ctrl && key.name === 'p') {
      const idx = availableModels.indexOf(modelId);
      const next = availableModels[(idx + 1) % availableModels.length] ?? modelId;
      if (next !== modelId) {
        setModelId(next);
        appendLine(`已切换模型: ${next}`);
      }
      return;
    }
    if (key.name === 'pageup') {
      scrollOutput(ROWS - fixedRowsFor(model.input)); // 回看一屏
      return;
    }
    if (key.name === 'pagedown') {
      scrollOutput(-(ROWS - fixedRowsFor(model.input))); // 返回一屏
      return;
    }
    if (key.name === 'return' && key.shift) {
      // Shift+Enter：插入换行（多行输入，默认单行）
      rlAny.line = rlAny.line.slice(0, rlAny.cursor) + '\n' + rlAny.line.slice(rlAny.cursor);
      rlAny.cursor += 1;
      syncInput();
      render();
      return;
    }
    if (model.menu) {
      if (key.name === 'up') {
        menuStep(model, -1);
        render();
        return;
      }
      if (key.name === 'down') {
        menuStep(model, 1);
        render();
        return;
      }
      if (key.name === 'escape') {
        menuClose(model);
        render();
        return;
      }
      if (key.name === 'return') {
        const pick = menuPick(model) ?? rlAny.line;
        const apply = model.menu?.apply;
        menuClose(model);
        if (apply) {
          apply(pick);
          render();
          return;
        }
        rlAny.line = pick;
        syncInput();
        origTtyWrite('\r', { name: 'return', ctrl: false, meta: false, shift: false, sequence: '\r' });
        return;
      }
    }
    // 对齐 pi alternate-scroll：滚轮被终端翻译为 ↑/↓ 键序列——输入框为空时 ↑↓ 滚动输出视口（原生选中已恢复）
    if (key.name === 'up' && model.input === '') {
      scrollOutput(3); // 滚轮上/↑：回看 3 行
      return;
    }
    if (key.name === 'down' && model.input === '') {
      scrollOutput(-3); // 滚轮下/↓：返回 3 行
      return;
    }
    origTtyWrite(sStr, key);
    syncInput();
    // 菜单候选：/ 命令 或 @ 文件（TuiController 纯函数，可单测）
    updateMenuForLine(model, rlAny.line, (line) => (line.startsWith('/') ? commandCompletions(line, availableModels) : fileCompletions(line)));
    render();
  };

  // ---- 单条输入处理（slash / agent） ----
  const processInputInner = async (input: string): Promise<void> => {
    if (input && history[history.length - 1] !== input) {
      history.push(input);
      if (history.length > 50) history.shift();
    }
    if (running && !input.startsWith('/')) {
      appendLine('\x1b[33m任务运行中（Ctrl+C 中止后再输入）\x1b[0m');
      return;
    }
    if (input === '/model') {
      model.menu = {
        candidates: availableModels,
        index: Math.max(0, availableModels.indexOf(modelId)),
        apply: (pick) => {
          if (pick !== modelId) {
            setModelId(pick);
            appendLine(`已切换模型: ${pick}`);
          }
        },
      };
      render();
      return;
    }
    const res = await handleSlash(input, slashCtx);
    if (res.handled) {
      if (res.output) appendLine(res.output);
      if (res.exitCode !== undefined) {
        appendLine(`会话已保存：${session.sessionId.slice(0, 8)}…（dscode -c 可恢复）`);
        exitCode = res.exitCode;
        rl.close();
      }
      return;
    }
    // Agent 任务
    appendLine(`\x1b[36m> ${input}\x1b[0m`);
    usage.requests++;
    running = true;
    const turnStart = Date.now();
    // 输入框上方固定实时运行状态行：耗时每秒跳动 + token 实时累计
    model.runStatus = runningStatusText(0);
    const runTimer = setInterval(() => {
      model.runStatus = runningStatusText(Date.now() - turnStart);
      render();
    }, 1000);
    resetCodeFence();
    const logger = createDebugLogger({ debug: process.env['DSCODE_DEBUG'] === '1', sessionId: session.sessionId });
    try {
      const expanded = await expandInput(input, session.cwd);
      for await (const ev of session.run(expanded)) {
        logger?.log(ev);
        if (ev.type === 'message_update') {
          const sep = reasoningShown || reasoningStreamed ? '\n' : '';
          reasoningShown = false;
          reasoningStreamed = false;
          appendInline(`${sep}${renderStreamingText(ev.content)}`); // 流式正文内联
        } else if (ev.type === 'reasoning_update') {
          appendInline(renderEventText(ev)); // 灰色思考流式内联
        } else {
          appendLine(renderEventText(ev)); // 工具调用/结果：新行
        }
        if (ev.type === 'agent_settled') {
          usage.promptTokens = ev.usage.prompt_tokens ?? usage.promptTokens;
          usage.completionTokens = ev.usage.completion_tokens ?? usage.completionTokens;
          usage.cacheReadTokens = ev.usage.cache_read_input_tokens ?? usage.cacheReadTokens;
          appendLine(`\x1b[90m(${fmtDuration(Date.now() - turnStart)} · ↑ ${fmtTokens(usage.promptTokens)} tokens)\x1b[0m`);
        }
      }
      appendLine('');
    } catch (err) {
      appendLine(`\x1b[31m任务异常: ${friendlyError(err)}\x1b[0m`);
    } finally {
      clearInterval(runTimer); // 停止实时状态行更新
      logger?.close();
      running = false;
      model.runStatus = ''; // 运行结束：清除固定状态行（恢复空行，布局不变）
    }
    setStatus();
    render();
  };

  /** 防御：processInput 任何未预期错误转为友好提示，绝不因未处理拒绝导致进程退出（Bun 对 unhandled rejection 直接退出） */
  const processInput = async (input: string): Promise<void> => {
    try {
      await processInputInner(input);
    } catch (err) {
      try {
        appendLine(`\x1b[31m内部错误: ${friendlyError(err)}\x1b[0m`);
      } catch {
        // 渲染崩溃等极端情况：静默
      }
    }
  };

  // ---- 粘贴安全输入循环 ----
  const PASTE_WINDOW_MS = 120;
  let pending: string | null = null;
  let pendingCount = 0;
  let lastLineAt = 0;
  let flushTimer: NodeJS.Timeout | null = null;
  const flushPending = (): void => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (pending === null) return;
    const total = pendingCount + 1;
    const merged = pending.trim();
    pending = null;
    pendingCount = 0;
    void processInput(merged).catch(() => {}); // .catch 兜底：防御未处理拒绝（Bun 会直接退出）
    if (total > 1) appendLine(`\x1b[33m（检测到 ${total} 行多行输入，已折叠为单行）\x1b[0m`);
  };
  rl.on('line', (rawLine) => {
    const input = rawLine.trim();
    if (!input) return;
    const now = Date.now();
    if (pending !== null && !pending.startsWith('/') && shouldMergePaste(input, lastLineAt, now, PASTE_WINDOW_MS)) {
      pending += ` ${input}`;
      pendingCount++;
      lastLineAt = now;
    } else {
      flushPending();
      pending = input;
      pendingCount = 0;
      lastLineAt = now;
    }
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushPending, PASTE_WINDOW_MS);
    syncInput(); // Enter 后 readline 已清空输入缓冲区，同步模型（修复输入行/光标残留）
  });

  // ---- 退出 ----
  const cleanup = (): void => {
    if (TTY) {
      process.stdout.write('\x1b[?25h\x1b[?1007l\x1b[?1049l'); // 显示光标 + 关闭 alternate-scroll + 退出 alternate screen
    }
  };
  const onSigint = (): void => {
    if (running) {
      session.abort();
      appendLine('[已中止]');
    } else {
      cleanup();
      appendLine(`会话已保存：${session.sessionId.slice(0, 8)}…（dscode -c 可恢复）`);
      rl.close();
      process.exit(0);
    }
  };
  rl.on('SIGINT', onSigint);

  // ---- 启动 ----
  if (TTY) process.stdout.write('\x1b[?1049h'); // 进入 alternate screen
  if (TTY) process.stdout.write('\x1b[?1007h'); // alternate-scroll：滚轮→↑↓键序列（不启用鼠标捕获，原生选中保持可用，对齐 pi）
  appendLine(`\x1b[36m${DSCCODE_LOGO}\x1b[0m`); // ASCII logo（Claude Code 风格欢迎）
  appendLine(welcomeBox({ version: DSCCODE_VERSION, model: modelId, cwd: session.cwd, approval }, COLS)); // Codex 风格信息框
  appendLine(`\x1b[90m输入 /help 查看命令，/exit 退出\x1b[0m`);
  rl.resume(); // 唤醒 stdin

  await new Promise<void>((resolve) => {
    rl.on('close', () => {
      flushPending();
      cleanup();
      resolve();
    });
  });
  return exitCode;
}
