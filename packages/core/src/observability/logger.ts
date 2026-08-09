/**
 * DEBUG 事件日志（横切项 P1：日志与可观测，NFR-4）。
 * 观测点=事件流：在 AgentEvent 消费点写入（与验收脚本统一消费事件，不做独立 instrumentation 层）。
 * `DSCODE_DEBUG=1` 时写入 ~/.dscode/logs/<时间戳>-<session>.log（JSONL）：
 * 每行 { ts, type, data }；agent_settled 含 reason（收敛原因）与 usage（每轮 input/output/cache token）。
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import { dscodeHome } from '../session/manager.js';
import type { AgentEvent } from '../agent/events.js';

export interface DebugEventLogger {
  log(ev: AgentEvent): void;
  close(): void;
}

/** 事件 → 精简负载（不含函数/循环引用） */
function serialize(ev: AgentEvent): Record<string, unknown> {
  switch (ev.type) {
    case 'message_update':
      return { content: ev.content };
    case 'reasoning_update':
      return { content: ev.content };
    case 'tool_call':
      return { toolCallId: ev.toolCallId, toolName: ev.toolName, args: ev.args };
    case 'tool_result':
      return { toolName: ev.toolName, isError: ev.isError, output: ev.output };
    case 'agent_settled':
      // NFR-4 附加判据：每轮收敛原因 + usage（可换算成本）
      return { reason: ev.reason, usage: ev.usage };
    case 'agent_start':
      return { input: ev.input };
    default:
      return {};
  }
}

export interface CreateDebugLoggerOptions {
  /** DEBUG 开关（session.debug / DSCODE_DEBUG=1） */
  debug: boolean;
  /** 日志目录基准（dscodeHome；env 可注入） */
  env?: Record<string, string | undefined>;
  sessionId?: string;
}

export function createDebugLogger(opts: CreateDebugLoggerOptions): DebugEventLogger | null {
  if (!opts.debug) return null;
  const env = opts.env ?? process.env;
  const id = opts.sessionId ? opts.sessionId.slice(0, 8) : 'anon';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(dscodeHome(env), 'logs');
  // createWriteStream 不会建父目录：先 mkdir 再写（否则日志静默丢失）
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ts}-${id}.log`);
  const stream: WriteStream = createWriteStream(file, { flags: 'a' });
  stream.on('error', () => {
    // 日志写失败不阻塞主流程
  });
  return {
    log(ev) {
      stream.write(`${JSON.stringify({ ts: Date.now(), type: ev.type, data: serialize(ev) })}\n`);
    },
    close() {
      stream.end();
    },
  };
}
