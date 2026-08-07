import { describe, expect, it } from 'vitest';
import { McpClient } from './mcp-client.js';
import { wrapMcpTool, registerMcpTools } from './mcp-tools.js';
import { ToolRegistry } from '../tool.js';

/** 假 MCP server（node -e stdio 子进程）：newline JSON-RPC 往返 */
const FAKE_SERVER = `
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  let result;
  if (msg.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake-server', version: '1.0' } };
  else if (msg.method === 'tools/list') result = { tools: [{ name: 'echo', description: '回显', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] };
  else if (msg.method === 'tools/call') result = { content: [{ type: 'text', text: 'echo:' + (msg.params.arguments || {}).text }] };
  else result = { ok: true };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
});
`;

function makeClient(): McpClient {
  return new McpClient(process.execPath, ['-e', FAKE_SERVER]);
}

describe('McpClient（stdio 传输 + JSON-RPC 往返，todos M7）', () => {
  it('connect 握手返回 serverInfo', async () => {
    const c = makeClient();
    const info = await c.connect();
    expect(info.name).toBe('fake-server');
    expect(c.isConnected).toBe(true);
    await c.close();
  });

  it('tools/list 返回 server 工具', async () => {
    const c = makeClient();
    await c.connect();
    const tools = await c.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('echo');
    await c.close();
  });

  it('tools/call 转发并回传结果', async () => {
    const c = makeClient();
    await c.connect();
    const { text, isError } = await c.callTool('echo', { text: 'hi' });
    expect(text).toBe('echo:hi');
    expect(isError).toBeUndefined();
    await c.close();
  });
});

describe('MCP 工具注入（原理-mcp.md §3.1）', () => {
  it('wrapMcpTool：隔离命名 + execute 转发 callTool', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const client = {
      async callTool(name: string, args: unknown) {
        calls.push({ name, args });
        return { text: `ok:${name}` };
      },
    } as unknown as McpClient;
    const tool = wrapMcpTool(client, 'filesystem', { name: 'read', description: '读文件', inputSchema: { type: 'object' } });
    expect(tool.name).toBe('filesystem.read'); // 隔离命名
    const result = await tool.execute('t1', { path: '/a' } as never, { cwd: '/' });
    expect(calls).toEqual([{ name: 'read', args: { path: '/a' } }]);
    expect(result.output).toBe('ok:read');
  });

  it('registerMcpTools 注册全部 server 工具并返回数量', async () => {
    const client = {
      async listTools() {
        return [
          { name: 'a', inputSchema: {} },
          { name: 'b', inputSchema: {} },
        ];
      },
      async callTool() {
        return { text: '' };
      },
    } as unknown as McpClient;
    const registry = new ToolRegistry();
    const n = await registerMcpTools(registry, client, 'srv');
    expect(n).toBe(2);
    expect(registry.getAll().map((t) => t.name)).toEqual(['srv.a', 'srv.b']);
  });
});
