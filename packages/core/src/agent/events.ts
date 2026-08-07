/**
 * Agent 生命周期事件（原理-agentloop.md §8）。
 * run() 以异步生成器产出这些事件，TUI/print/json 各模式自行消费
 * （事件流即观测点，见 原理-agentloop.md §8 注）。
 */

export type AgentEvent =
  | { type: 'agent_start'; input: string }
  | { type: 'message_update'; content: string }
  | { type: 'reasoning_update'; content: string }
  | { type: 'tool_call'; toolCallId: string; toolName: string; args: string }
  | { type: 'tool_result'; toolCallId: string; toolName: string; output: string; isError: boolean }
  | { type: 'agent_settled'; reason: 'no-tool-calls' | 'max-turns' | 'aborted' };
