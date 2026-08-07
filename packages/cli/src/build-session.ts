/**
 * 会话装配：把 args + provider + tools 组装成一个 AgentSession。
 * 供各模式（print/interactive）复用（架构文档 §4.2.1）。
 */

import { createRequire } from 'node:module';
import process from 'node:process';
import { OpenAIClient, resolveApiKey, resolveBaseUrl } from '@dscode/ai';
import { AgentSessionRuntime, createBuiltinRegistry, type AgentSession } from '@dscode/core';
import type { CliArgs } from './args.js';

const require = createRequire(import.meta.url);

export interface BuildSessionResult {
  session: AgentSession;
  /** 无可用 key 时的错误提示（SC-1.1：无配置时引导输入） */
  authError?: string;
}

/** 装配会话；鉴权失败时返回 authError 而非抛异常（由模式决定如何引导） */
export async function buildSession(args: CliArgs): Promise<BuildSessionResult> {
  const resolved = await resolveApiKey({ cliApiKey: args.apiKey });
  if (!resolved?.key) {
    return {
      session: null as unknown as AgentSession,
      authError: '未找到 DeepSeek API key。请用 --api-key 指定，或运行 dscode 交互模式首次引导，或设置 DEEPSEEK_API_KEY 环境变量。',
    };
  }

  const client = new OpenAIClient({
    baseUrl: resolveBaseUrl(),
    apiKey: resolved.key,
  });

  const session = AgentSessionRuntime.create({
    cwd: process.cwd(),
    tools: createBuiltinRegistry(),
    client,
    model: args.model,
  });
  await session.prepare();
  return { session };
}

/** 依赖树里 core 的 tools 注册表构建（显式引用避免摇树） */
export function buildTools() {
  return createBuiltinRegistry();
}

export { require };
