/**
 * 事件总线（架构文档 §4.2.8、todos M4-S1）。
 * - on(event, handler)：订阅，返回取消订阅函数
 * - emit(event, payload)：依次调用 handler，任一返回 { block: true } 即拦截
 * - 供扩展订阅，也供内置机制（权限/compaction）同构使用
 */

import type { ExtensionEventMap, ExtensionEventName, ExtensionHandler, ExtensionHandlerResult } from './events.js';

export class EventBus {
  private handlers = new Map<ExtensionEventName, Set<ExtensionHandler<ExtensionEventName>>>();

  /** 订阅事件；返回取消订阅函数 */
  on<K extends ExtensionEventName>(event: K, handler: ExtensionHandler<K>): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as ExtensionHandler<ExtensionEventName>);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler as ExtensionHandler<ExtensionEventName>);
    };
  }

  /** 发事件：handler 返回 { block: true } 立即停止并返回拦截结果；无拦截返回 undefined */
  async emit<K extends ExtensionEventName>(event: K, payload: ExtensionEventMap[K]): Promise<ExtensionHandlerResult | undefined> {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return undefined;
    for (const handler of [...set]) {
      const result = await handler(payload);
      if (result?.block) return result;
    }
    return undefined;
  }

  /** 是否有人订阅了某事件 */
  has(event: ExtensionEventName): boolean {
    return (this.handlers.get(event)?.size ?? 0) > 0;
  }
}
