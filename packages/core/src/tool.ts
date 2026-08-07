/**
 * Tool 接口与注册器（架构文档 §4.2.5、原理-file-tools.md）。
 * 所有工具统一形态：typebox schema 声明参数 + execute 执行。
 */

import type { TSchema } from '@sinclair/typebox';
import type { ToolSchema } from '@dscode/ai';

/** 工具执行上下文：由 Agent Loop 注入 */
export interface ToolExecutionContext {
  /** 当前工作目录（路径安全基准，见 src/util/path.ts） */
  cwd: string;
  /** 中止信号（用户 Ctrl+C / 超时） */
  signal?: AbortSignal;
  /** 流式更新回调（TUI/print 消费，可选） */
  onUpdate?: (chunk: string) => void;
  /** M5：sub-agent 工厂（task 工具用）——隔离子会话执行并返回摘要 */
  subAgent?: (prompt: string) => Promise<string>;
}

/** 工具执行结果：output 回喂模型，metadata 供渲染 */
export interface ToolResult {
  /** 回喂模型的文本（含错误文本——失败也要让模型看到并自愈） */
  output: string;
  /** 结构化元数据（渲染用，如 read 的 totalLines） */
  metadata?: Record<string, unknown>;
  /** 失败标记：非 0 退出码、编辑失败等 */
  isError?: boolean;
}

export interface Tool<P extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  label?: string;
  description: string;
  /** typebox schema：既是模型可见的契约，也是执行前校验 */
  parameters: TSchema;
  execute(toolCallId: string, params: P, ctx: ToolExecutionContext): Promise<ToolResult>;
  /** TUI 渲染钩子（可选） */
  renderCall?(args: P): string[];
  renderResult?(result: ToolResult): string[];
}

/** 工具注册表（todos M1-S3 验收：注册 read 后 getAll() 含之） */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具已注册: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  /** 生成 OpenAI 兼容 tools schema，随 prompt 发给模型 */
  toOpenAITools(): ToolSchema[] {
    return [...this.tools.values()].map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
}
