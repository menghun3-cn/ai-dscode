/**
 * rpc 模式（架构文档 §4.2.9、todos M7、FR-11）。
 * JSON-RPC 2.0 over stdio（newline 分隔）：外部进程集成。
 * 方法：
 * - ping → { pong: true }
 * - send { prompt } → 运行 Agent Loop，逐事件发 `event` 通知，回复最终文本
 * - quit → 退出
 * 与 MCP client 同构的 framing；命令集对齐 interactive 的核心能力。
 */

import process from 'node:process';
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { AgentEvent, AgentSession } from '@dscode/core';

export interface RpcStreams {
  input?: Readable;
  output?: Writable;
}

export async function runRpc(session: AgentSession, streams: RpcStreams = {}): Promise<number> {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;
  const rl = readline.createInterface({ input });
  const send = (msg: unknown): void => {
    output.write(`${JSON.stringify(msg)}\n`);
  };

  const respond = (id: number, result: unknown): void => {
    send({ jsonrpc: '2.0', id, result });
  };
  const respondError = (id: number, code: number, message: string): void => {
    send({ jsonrpc: '2.0', id, error: { code, message } });
  };
  const notify = (method: string, params: unknown): void => {
    send({ jsonrpc: '2.0', method, params });
  };

  /** send：跑一轮 agent loop，事件流通知，返回最终回复文本 */
  const handleSend = async (id: number, params: { prompt?: string }): Promise<void> => {
    const prompt = params?.prompt;
    if (!prompt) return void respondError(id, -32602, '缺少 prompt 参数');
    try {
      let reply = '';
      for await (const ev of session.run(prompt)) {
        notify('event', { type: ev.type, ...summarizeEvent(ev) });
        if (ev.type === 'message_update') reply += ev.content;
      }
      respond(id, { reply });
    } catch (err) {
      respondError(id, -32603, err instanceof Error ? err.message : String(err));
    }
  };

  return new Promise<number>((resolve) => {
    // 串行处理链：readline 的 async handler 不保证顺序，quit 必须等前面的 send 完成
    let chain: Promise<void> = Promise.resolve();
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let msg: { jsonrpc?: string; id?: number; method?: string; params?: unknown };
      try {
        msg = JSON.parse(line) as { jsonrpc?: string; id?: number; method?: string; params?: unknown };
      } catch {
        return; // 非法行忽略
      }
      if (msg.id === undefined) return; // 通知忽略
      const id = msg.id;
      const method = msg.method ?? '';
      const params = (msg.params ?? {}) as Record<string, unknown>;
      chain = chain.then(async () => {
        switch (method) {
          case 'ping':
            respond(id, { pong: true });
            break;
          case 'send':
            await handleSend(id, params as { prompt?: string });
            break;
          case 'quit':
            respond(id, { ok: true });
            resolve(0);
            rl.close();
            break;
          default:
            respondError(id, -32601, `未知方法: ${method}`);
        }
      });
    });
    // stdin EOF（管道关闭）不等同于退出：等处理链 settle 后再结束，避免截断 send 回复
    rl.on('close', () => {
      void chain.then(() => resolve(0));
    });
  });
}

/** 事件 → 可序列化的精简负载（不含函数/循环引用） */
function summarizeEvent(ev: AgentEvent): Record<string, unknown> {
  switch (ev.type) {
    case 'message_update':
      return { content: ev.content };
    case 'reasoning_update':
      return { content: ev.content };
    case 'tool_call':
      return { toolName: ev.toolName, args: ev.args };
    case 'tool_result':
      return { toolName: ev.toolName, isError: ev.isError, output: ev.output };
    case 'agent_settled':
      return { reason: ev.reason, usage: ev.usage };
    default:
      return {};
  }
}
