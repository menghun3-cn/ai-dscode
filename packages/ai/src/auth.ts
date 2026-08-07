/**
 * 鉴权解析器（需求文档 FR-1、成功标准 SC-1.1/SC-1.2）。
 * 优先级：`--api-key` > auth.json > 环境变量。
 * auth.json 格式：{"deepseek": {"type": "api_key", "key": "sk-..."}}，权限 0600。
 * 环境变量：`DSCODE_API_KEY`（主）、`DSCODE_BASE_URL`（主，默认官方网关）；
 * 兼容 `DEEPSEEK_API_KEY` / `DSAPI_API_KEY` / `DSAPI_BASE_URL`（用户既有环境，FR-1.3）。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type AuthSource = 'cli' | 'file' | 'env';

export interface AuthResult {
  key: string;
  source: AuthSource;
}

export interface AuthResolveOptions {
  /** --api-key 启动覆盖 */
  cliApiKey?: string;
  /** 测试注入：auth.json 绝对路径（默认 ~/.dscode/auth.json） */
  authFile?: string;
  /** 测试注入：环境变量快照（默认 process.env） */
  env?: Record<string, string | undefined>;
}

/** 默认 auth.json 路径：DSCODE_HOME 覆盖（验收脚本/自定义位置）> ~/.dscode/auth.json */
function defaultAuthFile(env: Record<string, string | undefined> = process.env): string {
  const home = env['DSCODE_HOME'];
  if (home) return path.join(home, 'auth.json');
  return path.join(os.homedir(), '.dscode', 'auth.json');
}

/** 解析 API key：--api-key > auth.json > env（DSCODE_API_KEY，兼容 DEEPSEEK_API_KEY/DSAPI_API_KEY） */
export async function resolveApiKey(opts: AuthResolveOptions = {}): Promise<AuthResult | undefined> {
  // 1. CLI --api-key
  if (opts.cliApiKey) return { key: opts.cliApiKey, source: 'cli' };

  // 2. auth.json
  const authFile = opts.authFile ?? defaultAuthFile(opts.env);
  try {
    const raw = await fs.readFile(authFile, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, { type?: string; key?: string }>;
    const entry = parsed['deepseek'] ?? parsed['default'];
    if (entry?.key) return { key: entry.key, source: 'file' };
  } catch {
    // 文件不存在或损坏：落到 env
  }

  // 3. 环境变量（主 DSCODE_API_KEY；兼容 DEEPSEEK_API_KEY / DSAPI_API_KEY）
  const env = opts.env ?? process.env;
  const envKey = env['DSCODE_API_KEY'] ?? env['DEEPSEEK_API_KEY'] ?? env['DSAPI_API_KEY'];
  if (envKey) return { key: envKey, source: 'env' };

  return undefined;
}

export interface AuthSaveOptions {
  key: string;
  provider?: string;
  /** 测试注入：auth.json 绝对路径（默认 $DSCODE_HOME/auth.json 或 ~/.dscode/auth.json） */
  authFile?: string;
  /** 测试注入：环境变量快照（默认 process.env，用于 DSCODE_HOME） */
  env?: Record<string, string | undefined>;
}

/** 写入 auth.json（0600）。返回写入路径。 */
export async function saveAuthKey(opts: AuthSaveOptions): Promise<string> {
  const provider = opts.provider ?? 'deepseek';
  const authFile = opts.authFile ?? defaultAuthFile(opts.env);
  await fs.mkdir(path.dirname(authFile), { recursive: true });
  const existing = await readAuthFile(authFile);
  existing[provider] = { type: 'api_key', key: opts.key };
  const json = `${JSON.stringify(existing, null, 2)}\n`;
  await fs.writeFile(authFile, json, { mode: 0o600 });
  // Windows 下 mode 不完全生效，尽力 chmod（SC-1.1 允许 Windows 查 ACL）
  await fs.chmod(authFile, 0o600).catch(() => {});
  return authFile;
}

/** 解析 baseUrl：DSCODE_BASE_URL（主）> DSAPI_BASE_URL（兼容）> 默认官方 DeepSeek 网关 */
export function resolveBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env['DSCODE_BASE_URL'] ?? env['DSAPI_BASE_URL'] ?? 'https://api.deepseek.com';
}

async function readAuthFile(authFile: string): Promise<Record<string, { type: string; key: string }>> {
  try {
    const raw = await fs.readFile(authFile, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, { type?: string; key?: string }>;
    const out: Record<string, { type: string; key: string }> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v?.key) out[k] = { type: v.type ?? 'api_key', key: v.key };
    }
    return out;
  } catch {
    return {};
  }
}
