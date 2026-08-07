/**
 * OpenAI 兼容 SSE 解析器（增量式，按 \n\n 切分完整事件）。
 * 协议：data: {...}\n\n ... data: [DONE]
 */

export class SSEParser {
  private buffer = '';
  private done = false;

  /** 喂入一段文本，返回其中完整事件的 JSON 对象 */
  push(chunk: string): Record<string, unknown>[] {
    this.buffer += chunk;
    const events: Record<string, unknown>[] = [];
    for (;;) {
      const sep = this.buffer.indexOf('\n\n');
      if (sep === -1) break;
      const raw = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      const data = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      if (data === '[DONE]') {
        this.done = true;
        break;
      }
      try {
        events.push(JSON.parse(data) as Record<string, unknown>);
      } catch {
        // 坏行跳过（协议容忍）
      }
    }
    return events;
  }

  get isDone(): boolean {
    return this.done;
  }
}
