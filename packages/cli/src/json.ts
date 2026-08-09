/**
 * json 模式（todos M7-S3、SC-6.3）。
 * `dscode -p "任务" --mode json`：每行一个 `{"type","data"}` 的标准化事件，
 * 供 CI 消费。每行 JSON.parse 可过（SC-6.3 通过判据）。
 */

import process from 'node:process';
import type { Writable } from 'node:stream';
import { createDebugLogger, type AgentEvent, type AgentSession } from '@dscode/core';
import { resolvePrintPrompt } from './print.js';
import { friendlyError } from './errors.js';

export interface JsonStreams {
  output?: Writable;
}

/** 事件 → `{type,data}` 的标准负载（不含函数/循环引用） */
export function serializeJsonEvent(ev: AgentEvent): { type: string; data: Record<string, unknown> } {
  switch (ev.type) {
    case 'message_update':
      return { type: ev.type, data: { content: ev.content } };
    case 'reasoning_update':
      return { type: ev.type, data: { content: ev.content } };
    case 'tool_call':
      return { type: ev.type, data: { toolCallId: ev.toolCallId, toolName: ev.toolName, args: ev.args } };
    case 'tool_result':
      return { type: ev.type, data: { toolName: ev.toolName, isError: ev.isError, output: ev.output } };
    case 'agent_settled':
      return { type: ev.type, data: { reason: ev.reason, usage: ev.usage } };
    case 'agent_start':
      return { type: ev.type, data: { input: ev.input } };
    default:
      // 全部已知事件已在上方覆盖，此处仅兜底未知类型
      return { type: (ev as { type: string }).type, data: {} };
  }
}

export async function runJson(
  session: AgentSession,
  prompt: string | undefined,
  positionals: string[] = [],
  streams: JsonStreams = {},
): Promise<number> {
  const output = streams.output ?? process.stdout;
  const input = await resolvePrintPrompt(prompt, positionals);
  if (!input.trim()) {
    process.stderr.write('json 模式缺少 prompt。用法: dscode -p "任务描述" --mode json，或管道输入: echo "..." | dscode -p - --mode json\n');
    return 2;
  }

  let sawError = false;
  const logger = createDebugLogger({ debug: process.env['DSCODE_DEBUG'] === '1', sessionId: session.sessionId });
  try {
    for await (const ev of session.run(input)) {
      logger?.log(ev);
      const line = serializeJsonEvent(ev);
      output.write(`${JSON.stringify(line)}\n`);
      if (ev.type === 'tool_result' && ev.isError) sawError = true;
    }
  } catch (err) {
    output.write(`${JSON.stringify({ type: 'error', data: { message: friendlyError(err) } })}\n`);
    return 1;
  } finally {
    logger?.close();
  }
  return sawError ? 1 : 0;
}
