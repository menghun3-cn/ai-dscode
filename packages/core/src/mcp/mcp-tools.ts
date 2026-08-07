/**
 * MCP 工具注入（原理-mcp.md §3.1、todos M7）。
 * - server 的 tools 包装为 dscode Tool（JSON Schema → typebox Type.Unsafe）
 * - 隔离命名：`serverName.toolName` 防多 server 冲突
 * - 执行路由：模型调用 → client.callTool 转发 server → 结果回传
 */

import { Type } from '@sinclair/typebox';
import { ToolRegistry, type Tool } from '../tool.js';
import type { McpClient, McpToolDef } from './mcp-client.js';

/** 把单个 MCP 工具包装为 dscode Tool */
export function wrapMcpTool(client: McpClient, serverName: string, tool: McpToolDef): Tool {
  return {
    name: `${serverName}.${tool.name}`,
    description: tool.description ?? `MCP 工具（${serverName}）`,
    parameters: Type.Unsafe(tool.inputSchema ?? { type: 'object', properties: {} }),
    async execute(_toolCallId, params) {
      const { text, isError } = await client.callTool(tool.name, params);
      return { output: text, isError };
    },
  };
}

/** 拉取 server 全部工具并注册进 registry；返回注册数 */
export async function registerMcpTools(registry: ToolRegistry, client: McpClient, serverName: string): Promise<number> {
  const tools = await client.listTools();
  for (const t of tools) {
    registry.register(wrapMcpTool(client, serverName, t));
  }
  return tools.length;
}
