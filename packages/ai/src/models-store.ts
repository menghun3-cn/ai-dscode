/**
 * 远端模型目录（需求 FR-6.1、todos M3 P1）。
 * 从远端 URL 拉取模型目录并缓存到 ~/.dscode/models-store.json（DSCODE_HOME 可覆盖）。
 * 验收：拉取后离线可用——网络不可用时读缓存合并，不阻塞启动。
 *
 * 存储格式：{ "<providerId>": { "<modelId>": ModelDef, ... }, ... }
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ModelDef } from './provider.js';

/** 数据根目录：DSCODE_HOME env 覆盖（默认 ~/.dscode），与 core SessionManager 一致 */
function dscodeHome(env: Record<string, string | undefined> = process.env): string {
  return env['DSCODE_HOME'] ?? path.join(os.homedir(), '.dscode');
}

/** 远端目录 URL：DSCODE_MODELS_URL 配置（无则跳过拉取，仅用内置目录） */
export function modelsStoreUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  return env['DSCODE_MODELS_URL'] || undefined;
}

/** 缓存文件路径：$DSCODE_HOME/models-store.json（默认 ~/.dscode/models-store.json） */
export function modelsStorePath(env: Record<string, string | undefined> = process.env): string {
  return path.join(dscodeHome(env), 'models-store.json');
}

export type ModelsStore = Record<string, Record<string, ModelDef>>;

/** 读取缓存（离线可用）；无缓存返回 {} */
export async function readModelsStore(env: Record<string, string | undefined> = process.env): Promise<ModelsStore> {
  try {
    const raw = await fs.readFile(modelsStorePath(env), 'utf8');
    const parsed = JSON.parse(raw) as ModelsStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 从远端拉取目录（fetch）；失败抛错（调用方决定是否回退缓存） */
export async function fetchModelsStore(url: string, fetchImpl: typeof fetch = fetch): Promise<ModelsStore> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`模型目录拉取失败: ${res.status} ${res.statusText}`);
  const parsed = (await res.json()) as ModelsStore;
  return parsed && typeof parsed === 'object' ? parsed : {};
}

/** 拉取并写缓存，返回新目录（网络失败抛错，缓存保留旧值） */
export async function updateModelsStore(
  url: string,
  opts: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {},
): Promise<ModelsStore> {
  const store = await fetchModelsStore(url, opts.fetchImpl);
  await fs.mkdir(path.dirname(modelsStorePath(opts.env)), { recursive: true });
  await fs.writeFile(modelsStorePath(opts.env), `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  return store;
}

/** 把缓存目录合并进内置模型列表（远端同名模型覆盖，新模型追加） */
export function mergeModels(providers: Array<{ id: string; models: ModelDef[] }>, store: ModelsStore): void {
  for (const p of providers) {
    const remote = store[p.id];
    if (!remote) continue;
    const byId = new Map(p.models.map((m) => [m.id, m]));
    for (const [id, def] of Object.entries(remote)) {
      byId.set(id, def); // 远端覆盖/追加
    }
    p.models = [...byId.values()];
  }
}

/** 启动时尝试合并远端目录：有 URL 则拉取更新缓存（失败静默，用旧缓存），无 URL 用内置 */
export async function syncModelsStore(
  providers: Array<{ id: string; models: ModelDef[] }>,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const url = modelsStoreUrl();
  const cached = await readModelsStore();
  mergeModels(providers, cached); // 先合并缓存（离线可用）
  if (url) {
    try {
      const fresh = await updateModelsStore(url, { fetchImpl: opts.fetchImpl });
      mergeModels(providers, fresh); // 拉取成功再合并新值
    } catch {
      // 网络失败：保留缓存合并结果（离线可用）
    }
  }
}
