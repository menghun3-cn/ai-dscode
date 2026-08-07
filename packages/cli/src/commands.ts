/**
 * slash 命令路由（todos M1-S5）。
 * 纯函数 + 上下文注入，便于单测。TUI 把命令解析结果映射到实际动作。
 */

export interface SlashCommandContext {
  /** 当前模型 id */
  model: string;
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
  /** 退出码（/exit 返回 0，触发退出） */
  exitCode?: number;
  /** 要展示给用户的输出 */
  output?: string;
}

export function handleSlash(input: string, ctx: SlashCommandContext): SlashResult {
  if (!input.startsWith('/')) {
    return { handled: false };
  }
  const [cmd, ...rest] = input.slice(1).trim().split(/\s+/);
  const arg = rest.join(' ');

  switch (cmd) {
    case 'exit':
      return { handled: true, exitCode: 0 };
    case 'help':
      return {
        handled: true,
        output: [
          '可用命令：',
          '  /exit    退出 dscode',
          '  /help    显示本帮助',
          '  /model   显示当前模型；/model <id> 切换（如 /model deepseek-reasoner）',
          '  /cost    显示本轮 token 与成本统计',
          '  /clear   清空当前会话消息',
        ].join('\n'),
      };
    case 'model':
      if (arg) {
        ctx.setModel(arg);
        return { handled: true, output: `已切换模型: ${arg}` };
      }
      return { handled: true, output: `当前模型: ${ctx.model}` };
    case 'cost':
      return { handled: true, output: ctx.costText() };
    case 'clear':
      ctx.clearMessages();
      return { handled: true, output: '会话已清空' };
    default:
      return { handled: true, output: `未知命令: /${cmd}（/help 查看可用命令）` };
  }
}
