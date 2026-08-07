/**
 * Provider 抽象（架构文档 §4.2.4）：统一"接一家模型"的接口。
 * Agent Loop 只依赖 Provider/ModelDef，不关心背后是哪家。
 */

export interface ModelDef {
  id: string;
  name: string;
  /** R1 类推理模型：走 reasoning_content 字段解析 */
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  /** 每百万 token 价格（USD），供 /cost 计费 */
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** 支持的多模态输入 */
  input: Array<'text' | 'image' | 'audio'>;
}

export interface Provider {
  id: string;
  /** 决定用哪个协议 adapter（新接一家只需实现 adapter + ModelDef） */
  api: 'openai-chat' | 'openai-responses' | 'anthropic-messages';
  baseUrl: string;
  /** 静态 key 或惰性解析（如从 auth.json/env 读取） */
  apiKey: string | (() => Promise<string>);
  models: ModelDef[];
}

/** 全局注册表：按 provider id 存取（todos M1-S2 验收） */
export class ProviderRegistry {
  private providers = new Map<string, Provider>();

  register(provider: Provider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider 已注册: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  getAll(): Provider[] {
    return [...this.providers.values()];
  }
}
