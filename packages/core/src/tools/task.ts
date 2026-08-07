/**
 * task 工具（原理-plan-and-execute.md §6、todos M5-S3、SC-4.5）。
 * 主 agent 派生隔离的子 AgentSession 执行子任务：
 * - 共享 cwd，但 messages 不互通——子结果以摘要回灌主
 * - 子会话不落盘（persist=false），独立收敛
 */

import { Type, type Static } from '@sinclair/typebox';
import type { Tool } from '../tool.js';

export const taskParams = Type.Object({
  prompt: Type.String({ description: '子任务的目标指令（一句话说清要做什么、交付什么）' }),
});

export type TaskParams = Static<typeof taskParams>;

export const taskTool: Tool<TaskParams> = {
  name: 'task',
  description:
    '派一个隔离的子 agent 执行子任务（如信息收集、实验性脚本），子会话与主会话上下文隔离，结果以摘要回传。适合批量检索/隔离风险/并行任务。',
  parameters: taskParams,

  async execute(_toolCallId, params, ctx) {
    if (!ctx.subAgent) {
      return { output: 'task 工具不可用：当前运行环境未注入 sub-agent 工厂。', isError: true };
    }
    const summary = await ctx.subAgent(params.prompt);
    return { output: summary };
  },
};
