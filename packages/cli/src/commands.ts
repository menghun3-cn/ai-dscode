/**
 * slash 命令路由（todos M1-S5 / M2）。
 * 纯函数 + 上下文注入，便于单测。TUI 把命令解析结果映射到实际动作。
 * M2 新增会话命令：/resume /tree /fork /clone /name /export。
 */

import type { SessionEntry } from '@dscode/core';

/** M2：会话相关操作（由 TUI 用 AgentSession 实现注入） */
export interface SlashSessionOps {
  /** 当前 session id */
  id: string;
  /** 当前激活分支（从根到末端） */
  activeBranch: SessionEntry[];
  /** /tree <n>：跳到历史节点改写分支 */
  jumpTo(entryId: string): boolean;
  /** /fork <n>：从历史节点生成新会话文件（旧文件不变） */
  forkFrom(entryId: string): Promise<string>;
  /** /clone：复制当前分支到新会话 */
  clone(): Promise<string>;
  /** /name <名字>：会话命名（label entry） */
  label(name: string): Promise<void>;
  /** /export：导出当前分支为 markdown（或 /export html），返回文件路径 */
  exportMarkdown(html?: boolean): Promise<string>;
  /** /resume：列出本目录会话（含 /name 会话名） */
  listSessions(): Promise<Array<{ id: string; entries: number; mtime: number; name?: string }>>;
}

export interface SlashCommandContext {
  /** 当前模型 id */
  model: string;
  /** 可用模型 id 列表（/model 列出与编号选择） */
  availableModels: string[];
  /** 切换模型（/model <id>） */
  setModel: (id: string) => void;
  /** 清空会话消息（/clear） */
  clearMessages: () => void;
  /** 计费统计文本（/cost，M3 完善） */
  costText: () => string;
  /** reasoning 展示模式（/thinking 切换，SC-3.2） */
  thinkingMode: 'stream' | 'fold' | 'off';
  setThinkingMode: (mode: 'stream' | 'fold' | 'off') => void;
  /** M3 P1：手动拉取并合并远端模型目录，返回摘要文本 */
  updateModelsStore: () => Promise<string>;
  /** M4：扩展管理（/reload 热重载、/extensions 列出） */
  extensions: {
    reload: () => Promise<string>;
    list: () => string;
  };
  /** M4 P1：Skill 系统（/skill:<name> 加载指令注入上下文） */
  skills: {
    apply: (name: string) => Promise<string>;
    list: () => Promise<string>;
  };
  /** M5：Plan 模式（/plan 只读 → /accept-plan 落地，SC-4.4） */
  plan: {
    enter: () => string;
    accept: () => string;
    setSteps: (titles: string[]) => string;
  };
  /** M5：权限规则（/allow /deny 持久化，M5 P1） */
  permission: {
    allow: (rule: string) => Promise<string>;
    deny: (rule: string) => Promise<string>;
  };
  /** M2：会话操作（/resume /tree /fork /clone /name /export） */
  session: SlashSessionOps;
}

export interface SlashResult {
  /** 是否为 slash 命令 */
  handled: boolean;
  /** 退出码（/exit /quit 返回 0，触发退出） */
  exitCode?: number;
  /** 要展示给用户的输出 */
  output?: string;
}

/** 全部命令（/help 与补全共用） */
export const COMMANDS = ['exit', 'quit', 'help', 'model', 'cost', 'clear', 'thinking', 'models-update', 'extensions', 'reload', 'skill', 'plan', 'accept-plan', 'plan-set', 'allow', 'deny', 'resume', 'tree', 'fork', 'clone', 'name', 'export'] as const;

export async function handleSlash(input: string, ctx: SlashCommandContext): Promise<SlashResult> {
  if (!input.startsWith('/')) {
    return { handled: false };
  }
  const [cmd, ...rest] = input.slice(1).trim().split(/\s+/);
  const arg = rest.join(' ').trim();

  // /skill:<name>：加载 skill 指令注入上下文（渐进披露，原理-agentloop.md §7）。
  // 需在 switch 前匹配，避免命中 default 的"未知命令"。
  if (cmd?.startsWith('skill:')) {
    const name = cmd.slice('skill:'.length).trim();
    if (!name) return { handled: true, output: '用法: /skill:<名字>（如 /skill:lint；/skill 查看可用列表）' };
    return { handled: true, output: await ctx.skills.apply(name) };
  }

  switch (cmd) {
    case 'exit':
    case 'quit':
      return { handled: true, exitCode: 0 };
    case 'help':
      return {
        handled: true,
        output: [
          '可用命令（输入 / 后 Tab 补全）：',
          '  /exit    退出 dscode',
          '  /quit    退出 dscode（同 /exit）',
          '  /help    显示本帮助',
          '  /model   显示可用模型；/model <id|序号> 切换',
          '  /cost    显示本轮 token 与成本统计',
          '  /clear   清空当前会话消息',
          '  /thinking   reasoning 展示：stream/fold/off（SC-3.2）',
          '  /models-update  拉取并合并远端模型目录（FR-6.1）',
          '  /extensions     列出已加载扩展与错误（M4）',
          '  /reload         热重载扩展（改完即生效）',
          '  /skill:<名字>   加载 skill 指令注入上下文（如 /skill:lint；/skill 列出）',
          '  /plan           进入 Plan 模式（只读：写工具被拒，SC-4.4）',
          '  /plan-set <步骤…>  设置计划步骤清单（逗号分隔）',
          '  /accept-plan    接受计划，进入执行',
          '  /allow <规则>   允许规则并持久化（如 "bash:ls -la"，M5 P1）',
          '  /deny <规则>    拒绝规则并持久化（如 "bash:rm -rf *"）',
          '  /tree    查看会话树；/tree <n> 跳到该节点改写分支',
          '  /fork <n>  从历史节点分叉出新会话（旧文件不变）',
          '  /clone   复制当前分支为新会话',
          '  /name <名字>  给当前会话命名',
          '  /export  导出当前会话为 markdown',
          '  /resume  列出本目录会话（重启后用 dscode -c/-r 恢复）',
        ].join('\n'),
      };
    case 'model': {
      if (!arg) {
        // 列出可用模型（编号选择）
        const lines = ctx.availableModels.map((m, i) => {
          const current = m === ctx.model ? ' ← 当前' : '';
          return `  ${i + 1}. ${m}${current}`;
        });
        return {
          handled: true,
          output: `当前模型: ${ctx.model}\n可用模型（/model <id|序号> 切换）:\n${lines.join('\n')}`,
        };
      }
      const target = resolveModelArg(arg, ctx.availableModels);
      if (!target) {
        return {
          handled: true,
          output: `未知模型: ${arg}（/model 查看可用列表）`,
        };
      }
      ctx.setModel(target);
      return { handled: true, output: `已切换模型: ${target}` };
    }
    case 'cost':
      return { handled: true, output: ctx.costText() };
    case 'clear':
      ctx.clearMessages();
      return { handled: true, output: '会话已清空' };
    case 'thinking': {
      if (arg && ['stream', 'fold', 'off'].includes(arg)) {
        ctx.setThinkingMode(arg as 'stream' | 'fold' | 'off');
        return { handled: true, output: `reasoning 展示: ${arg}` };
      }
      return {
        handled: true,
        output: `当前 reasoning 展示: ${ctx.thinkingMode}\n用法: /thinking stream|fold|off（stream=流式灰色，fold=折叠一行，off=隐藏）`,
      };
    }
    case 'models-update': {
      const msg = await ctx.updateModelsStore();
      return { handled: true, output: msg };
    }
    case 'extensions': {
      return { handled: true, output: ctx.extensions.list() };
    }
    case 'reload': {
      const msg = await ctx.extensions.reload();
      return { handled: true, output: msg };
    }
    case 'skill': {
      return { handled: true, output: await ctx.skills.list() };
    }
    case 'plan': {
      return { handled: true, output: ctx.plan.enter() };
    }
    case 'accept-plan': {
      return { handled: true, output: ctx.plan.accept() };
    }
    case 'plan-set': {
      const titles = arg.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      if (titles.length === 0) return { handled: true, output: '用法: /plan-set 步骤1,步骤2,…' };
      return { handled: true, output: ctx.plan.setSteps(titles) };
    }
    case 'allow': {
      if (!arg) return { handled: true, output: '用法: /allow <规则>（如 /allow "bash:ls -la"）' };
      return { handled: true, output: await ctx.permission.allow(arg) };
    }
    case 'deny': {
      if (!arg) return { handled: true, output: '用法: /deny <规则>（如 /deny "bash:rm -rf *"）' };
      return { handled: true, output: await ctx.permission.deny(arg) };
    }

    // ---- M2 会话命令 ----
    case 'tree': {
      const branch = ctx.session.activeBranch;
      if (branch.length === 0) return { handled: true, output: '当前会话为空' };
      if (arg) {
        const idx = Number(arg) - 1;
        const entry = branch[idx];
        if (!entry) return { handled: true, output: `无效节点: ${arg}（/tree 查看列表）` };
        ctx.session.jumpTo(entry.id);
        return { handled: true, output: `已跳到节点 #${idx + 1}（${entry.type}）` };
      }
      const lines = branch.map((e, i) => {
        const preview = (e.content ?? e.name ?? '').slice(0, 60).replace(/\n/g, ' ');
        return `  #${i + 1} [${e.type}] ${preview}`;
      });
      return {
        handled: true,
        output: `会话树（${ctx.session.id.slice(0, 8)}…，${branch.length} 节点）:\n${lines.join('\n')}\n/tree <n> 跳到该节点；/fork <n> 从该节点分叉`,
      };
    }
    case 'fork': {
      const idx = Number(arg) - 1;
      const entry = ctx.session.activeBranch[idx];
      if (!entry) return { handled: true, output: `无效节点: ${arg}（/tree 查看列表）` };
      const newId = await ctx.session.forkFrom(entry.id);
      return { handled: true, output: `已分叉 → 新会话 ${newId.slice(0, 8)}…（旧文件不变）` };
    }
    case 'clone': {
      const newId = await ctx.session.clone();
      return { handled: true, output: `已复制当前分支 → 新会话 ${newId.slice(0, 8)}…（原会话不动）` };
    }
    case 'name': {
      if (!arg) return { handled: true, output: `用法: /name <会话名>` };
      await ctx.session.label(arg);
      return { handled: true, output: `已命名会话: ${arg}` };
    }
    case 'export': {
      const isHtml = arg.trim().toLowerCase() === 'html';
      const file = await ctx.session.exportMarkdown(isHtml);
      return { handled: true, output: `已导出（${isHtml ? 'HTML' : 'Markdown'}）: ${file}` };
    }
    case 'resume': {
      const list = await ctx.session.listSessions();
      if (list.length === 0) return { handled: true, output: '本目录暂无会话' };
      const lines = list.map(
        (m, i) => `  ${i + 1}. ${m.name ? `「${m.name}」` : m.id.slice(0, 8)}…（${m.entries} 条，${new Date(m.mtime).toLocaleString()}）`,
      );
      return {
        handled: true,
        output: `本目录会话（${list.length} 个）:\n${lines.join('\n')}\n重启后用 dscode -c 续最近 / dscode -r 选择恢复`,
      };
    }
    default:
      return { handled: true, output: `未知命令: /${cmd}（/help 查看可用命令）` };
  }
}

/** 解析模型参数：1-based 序号 或 直接模型 id；无效返回 undefined */
export function resolveModelArg(arg: string, availableModels: string[]): string | undefined {
  if (/^\d+$/.test(arg)) {
    const idx = Number(arg);
    return availableModels[idx - 1];
  }
  return availableModels.includes(arg) ? arg : undefined;
}

/**
 * 补全候选（TUI 输入 / 后 Tab 提示；纯函数便于单测）。
 * - 输入 `/` + 命令前缀（未到空格）→ 匹配 COMMANDS
 * - 输入 `/model <前缀>` → 匹配可用模型
 * - 其余 → 空
 */
export function commandCompletions(line: string, availableModels: string[]): string[] {
  if (line.startsWith('/model ')) {
    const prefix = line.slice('/model '.length);
    return availableModels.filter((m) => m.startsWith(prefix));
  }
  if (line.startsWith('/') && !line.includes(' ')) {
    const prefix = line;
    return COMMANDS.map((c) => `/${c}`).filter((c) => c.startsWith(prefix));
  }
  return [];
}

/** 菜单选中索引循环移动（↑↓ 选择，越界环绕） */
export function cycleMenuIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (index + delta + length) % length;
}
