/**
 * Compaction（原理-compact.md、todos M6、SC-5.1/5.2）。
 * - estimateTokens：启发式 token 估算（中文 ~1.2/字、英文 ~0.25/char）
 * - selectCutPoint：从最新消息倒着走，保留最近 keepRecentTokens 估量，返回切点
 * - summarizeMessages：一次 LLM 调用产出结构化摘要（目标/约束/进度/决策/下一步/关键文件）
 */

import type { ChatMessage } from '@dscode/ai';
import type { ChatStreamer } from '../agent/session.js';

/** 启发式 token 估算（原理-compact.md §2.3）：中文 ~1.2 token/字，英文 ~0.25 token/char */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk * 1.2 + other * 0.25);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(JSON.stringify(m)), 0);
}

export interface CutPoint {
  /** 保留段的起始下标（cutIndex 之前被切掉） */
  cutIndex: number;
  /** 被切段的估算 token 数 */
  cutTokens: number;
}

/** 从最新倒着走，保留最近 keepRecentTokens 估量；返回切点（cutIndex 之前压缩） */
export function selectCutPoint(messages: ChatMessage[], keepRecentTokens: number): CutPoint {
  let acc = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    acc += estimateTokens(JSON.stringify(messages[i]));
    if (acc >= keepRecentTokens) {
      return { cutIndex: i, cutTokens: acc };
    }
  }
  return { cutIndex: 0, cutTokens: acc }; // 全部保留（不够阈值）
}

/** 序列化被切段为文本（LLM 摘要的输入） */
export function serializeMessages(messages: ChatMessage[]): string {
  return messages
    .map((m) => `[${m.role}]${m.content ?? JSON.stringify(m.tool_calls ?? '')}`)
    .join('\n');
}

export interface SummarizeOptions {
  model: string;
  /** /compact 附加指令（SC-5.2：如"重点保留测试相关上下文"） */
  extra?: string;
  signal?: AbortSignal;
}

/**
 * 一次 LLM 调用生成结构化摘要。
 * 返回摘要文本；调用失败返回 null（调用方决定降级）。
 */
export async function summarizeMessages(
  client: ChatStreamer,
  messages: ChatMessage[],
  opts: SummarizeOptions,
): Promise<string | null> {
  const prompt = [
    '把下面的对话历史压缩成结构化摘要，保留关键事实，供后续任务继续使用。',
    '格式：',
    '- 目标：',
    '- 已完成的决定/进度：',
    '- 关键文件与操作：',
    '- 待办/下一步：',
    opts.extra ? `附加要求：${opts.extra}` : '',
    '--- 对话历史 ---',
    serializeMessages(messages),
  ]
    .filter(Boolean)
    .join('\n');

  try {
    let summary = '';
    for await (const ev of client.streamChat({
      model: opts.model,
      messages: [{ role: 'user', content: prompt }],
      signal: opts.signal,
    })) {
      if (ev.content) summary += ev.content;
    }
    return summary.trim() || null;
  } catch {
    return null;
  }
}
