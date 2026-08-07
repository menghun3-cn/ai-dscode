/**
 * slash 命令路由（todos M1-S5）。
 * 纯函数 + 上下文注入，便于单测。TUI 把命令解析结果映射到实际动作。
 */

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
export const COMMANDS = ['exit', 'quit', 'help', 'model', 'cost', 'clear'] as const;

export function handleSlash(input: string, ctx: SlashCommandContext): SlashResult {
  if (!input.startsWith('/')) {
    return { handled: false };
  }
  const [cmd, ...rest] = input.slice(1).trim().split(/\s+/);
  const arg = rest.join(' ').trim();

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
