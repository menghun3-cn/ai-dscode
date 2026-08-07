/**
 * MCP client（原理-mcp.md、todos M7、FR-11）。
 * - stdio 传输：spawn 子进程，newline 分隔的 JSON-RPC 2.0 over stdin/stdout
 * - 握手：initialize → notifications/initialized
 * - 能力：tools/list → 注入；tools/call → 转发执行
 * - 生命周期：connect / close；id 匹配请求响应
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

/** server 声明的工具（inputSchema 为 JSON Schema，见 原理-mcp.md §3.1） */
export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class McpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private connected = false;
  private serverInfo: McpServerInfo | null = null;

  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  getInfo(): McpServerInfo | null {
    return this.serverInfo;
  }

  /** 启动子进程 + initialize 握手（协议版本不兼容明确报错） */
  async connect(): Promise<McpServerInfo> {
    if (this.connected) return this.serverInfo!;
    const child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.rl = readline.createInterface({ input: child.stdout });

    child.stderr.on('data', (b: Buffer) => {
      // server 日志走 stderr，不污染 stdout 协议通道
      process.stderr.write(`[mcp:${this.command}] ${b.toString()}`);
    });
    child.on('error', (err) => this.rejectAll(err));
    child.on('close', () => {
      this.connected = false;
      this.rejectAll(new Error(`MCP server 已退出: ${this.command}`));
    });
    this.rl.on('line', (line) => this.onLine(line));

    // 握手：initialize → notifications/initialized
    const result = (await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dscode', version: '1.0.0' },
    })) as { protocolVersion?: string; serverInfo?: { name: string; version: string } };
    if (!result?.serverInfo) {
      await this.close();
      throw new Error('MCP initialize 失败：server 未返回 serverInfo');
    }
    this.notify('notifications/initialized', {});
    this.serverInfo = result.serverInfo;
    this.connected = true;
    return this.serverInfo;
  }

  /** tools/list：拉取 server 声明的工具 */
  async listTools(): Promise<McpToolDef[]> {
    const result = (await this.request('tools/list', {})) as { tools?: McpToolDef[] };
    return result?.tools ?? [];
  }

  /** tools/call：调用 server 工具，返回文本结果 */
  async callTool(name: string, args: unknown): Promise<{ text: string; isError?: boolean }> {
    const result = (await this.request('tools/call', { name, arguments: args ?? {} })) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    const text = (result?.content ?? []).map((c) => c.text ?? '').join('\n');
    return { text, isError: result?.isError };
  }

  async close(): Promise<void> {
    this.connected = false;
    this.rl?.close();
    this.rl = null;
    this.child?.kill();
    this.child = null;
  }

  // ---------- JSON-RPC 内部 ----------

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    if (!this.child) return Promise.reject(new Error('MCP client 未连接'));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.child!.stdin.write(`${msg}\n`);
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.child) return;
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.child.stdin.write(`${msg}\n`);
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // 非法行忽略
    }
    const id = msg['id'];
    if (typeof id === 'number') {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (msg['error'] !== undefined) {
        pending.reject(new Error(`MCP 错误 ${JSON.stringify(msg['error'])}`));
      } else {
        pending.resolve(msg['result']);
      }
    }
    // 服务端主动通知（如 resources 变化）暂忽略
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }
}
