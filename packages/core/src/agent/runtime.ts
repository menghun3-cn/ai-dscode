/**
 * AgentSessionRuntime：会话工厂（架构文档 §4.2.1）。
 * 负责 AgentSession 的创建（以及未来 session 切换/fork 的 teardown + rebuild）。
 */

import { AgentSession, type AgentSessionOptions } from './session.js';

export class AgentSessionRuntime {
  /** 创建会话实例（M1-S4 验收：能 new + dispose 无异常） */
  static create(opts: AgentSessionOptions): AgentSession {
    return new AgentSession(opts);
  }
}
