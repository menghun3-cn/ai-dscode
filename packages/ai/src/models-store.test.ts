import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  modelsStoreUrl,
  modelsStorePath,
  readModelsStore,
  updateModelsStore,
  mergeModels,
  syncModelsStore,
  type ModelsStore,
} from './models-store.js';
import type { ModelDef } from './provider.js';

let tmp: string;
let home: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-mstore-'));
  home = path.join(tmp, 'dscode-home');
  process.env['DSCODE_HOME'] = home;
});

afterAll(async () => {
  delete process.env['DSCODE_HOME'];
  delete process.env['DSCODE_MODELS_URL'];
  await fs.rm(tmp, { recursive: true, force: true });
});

const REMOTE_STORE: ModelsStore = {
  deepseek: {
    'deepseek-newmodel': { id: 'deepseek-newmodel', name: 'New', reasoning: false, contextWindow: 65536, maxTokens: 8192, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 }, input: ['text'] },
  },
  openai: {
    'gpt-5': { id: 'gpt-5', name: 'GPT-5', reasoning: true, contextWindow: 256000, maxTokens: 32768, cost: { input: 5, output: 20, cacheRead: 2.5, cacheWrite: 5 }, input: ['text'] },
  },
};

const fakeFetchOk = async () => new Response(JSON.stringify(REMOTE_STORE), { status: 200 }) as Response;
const fakeFetchFail = async () => new Response('', { status: 503 }) as Response;

function mkProvider(id: string, models: ModelDef[]): { id: string; models: ModelDef[] } {
  return { id, models };
}

describe('models-store（M3 P1：远端模型目录）', () => {
  it('modelsStoreUrl 读 DSCODE_MODELS_URL', () => {
    expect(modelsStoreUrl({ DSCODE_MODELS_URL: 'https://x/models.json' })).toBe('https://x/models.json');
    expect(modelsStoreUrl({})).toBeUndefined();
  });

  it('modelsStorePath 在 DSCODE_HOME 下', () => {
    expect(modelsStorePath({ DSCODE_HOME: home })).toBe(path.join(home, 'models-store.json'));
  });

  it('拉取并写缓存，随后离线可读（验收：拉取后离线可用）', async () => {
    const store = await updateModelsStore('https://example.com/models.json', { fetchImpl: fakeFetchOk as typeof fetch });
    expect(Object.keys(store)).toContain('deepseek');
    // 缓存文件已写入
    const raw = JSON.parse(await fs.readFile(modelsStorePath(), 'utf8'));
    expect(raw.openai['gpt-5'].id).toBe('gpt-5');
    // 离线读取缓存（不依赖网络）
    const cached = await readModelsStore();
    expect(cached.deepseek['deepseek-newmodel'].id).toBe('deepseek-newmodel');
  });

  it('拉取失败抛错且不破坏旧缓存', async () => {
    const before = await readModelsStore();
    await expect(
      updateModelsStore('https://example.com/models.json', { fetchImpl: fakeFetchFail as typeof fetch }),
    ).rejects.toThrow(/拉取失败/);
    const after = await readModelsStore();
    expect(after).toEqual(before); // 旧缓存保留
  });

  it('mergeModels：远端同名覆盖、新模型追加', () => {
    const providers = [
      mkProvider('deepseek', [
        { id: 'deepseek-chat', name: 'Chat', reasoning: false, contextWindow: 64, maxTokens: 8, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, input: ['text'] },
      ]),
    ];
    const store: ModelsStore = {
      deepseek: {
        'deepseek-chat': { id: 'deepseek-chat', name: 'Chat v2', reasoning: false, contextWindow: 128, maxTokens: 16, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }, input: ['text'] },
        'deepseek-new': { id: 'deepseek-new', name: 'New', reasoning: true, contextWindow: 128, maxTokens: 16, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }, input: ['text'] },
      },
    };
    mergeModels(providers, store);
    const ids = providers[0]!.models.map((m) => m.id);
    expect(ids).toContain('deepseek-chat');
    expect(ids).toContain('deepseek-new'); // 追加
    expect(providers[0]!.models.find((m) => m.id === 'deepseek-chat')!.contextWindow).toBe(128); // 覆盖
  });

  it('syncModelsStore：无 URL 仅合并缓存；有 URL 拉取失败时回退缓存（离线可用）', async () => {
    const providers = [
      mkProvider('deepseek', [
        { id: 'deepseek-chat', name: 'Chat', reasoning: false, contextWindow: 64, maxTokens: 8, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, input: ['text'] },
      ]),
    ];
    // 有 URL 但拉取失败 → 用缓存（deepseek-newmodel 已在上个用例缓存）
    process.env['DSCODE_MODELS_URL'] = 'https://example.com/models.json';
    await syncModelsStore(providers);
    expect(providers[0]!.models.some((m) => m.id === 'deepseek-newmodel')).toBe(true); // 来自缓存
  });
});
