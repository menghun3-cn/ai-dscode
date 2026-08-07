import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveApiKey, saveAuthKey, resolveBaseUrl } from './auth.js';

async function tmpAuthFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-auth-'));
  return path.join(dir, 'auth.json');
}

const AUTH_JSON = JSON.stringify({ deepseek: { type: 'api_key', key: 'sk-from-file' } });

describe('resolveApiKey 优先级：--api-key > auth.json > env', () => {
  it('cli key 优先', async () => {
    const authFile = await tmpAuthFile();
    await fs.writeFile(authFile, AUTH_JSON);
    const r = await resolveApiKey({
      cliApiKey: 'sk-cli',
      authFile,
      env: { DEEPSEEK_API_KEY: 'sk-env' },
    });
    expect(r).toEqual({ key: 'sk-cli', source: 'cli' });
  });

  it('auth.json 其次（无 cli key）', async () => {
    const authFile = await tmpAuthFile();
    await fs.writeFile(authFile, AUTH_JSON);
    const r = await resolveApiKey({ authFile, env: { DEEPSEEK_API_KEY: 'sk-env' } });
    expect(r).toEqual({ key: 'sk-from-file', source: 'file' });
  });

  it('env 兜底：DSCODE_API_KEY / DEEPSEEK_API_KEY / DSAPI_API_KEY', async () => {
    const authFile = await tmpAuthFile();
    expect(await resolveApiKey({ authFile, env: { DSCODE_API_KEY: 'sk-dscode' } })).toEqual({
      key: 'sk-dscode',
      source: 'env',
    });
    expect(await resolveApiKey({ authFile, env: { DEEPSEEK_API_KEY: 'sk-env' } })).toEqual({
      key: 'sk-env',
      source: 'env',
    });
    expect(await resolveApiKey({ authFile, env: { DSAPI_API_KEY: 'sk-dsapi' } })).toEqual({
      key: 'sk-dsapi',
      source: 'env',
    });
  });

  it('全部缺失返回 undefined（SC-1.1：无配置时提示输入）', async () => {
    const authFile = await tmpAuthFile();
    expect(await resolveApiKey({ authFile, env: {} })).toBeUndefined();
  });
});

describe('saveAuthKey', () => {
  it('写入 auth.json，格式与 0600 权限合规（SC-1.1）', async () => {
    const authFile = await tmpAuthFile();
    const written = await saveAuthKey({ key: 'sk-new', authFile });
    expect(written).toBe(authFile);
    const raw = JSON.parse(await fs.readFile(authFile, 'utf8'));
    expect(raw.deepseek).toEqual({ type: 'api_key', key: 'sk-new' });
    // Windows 下 mode 尽力生效（SC-1.1 允许查 ACL）；非 Windows 严格断言
    if (process.platform !== 'win32') {
      const stat = await fs.stat(authFile);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it('合并已存在的 provider 条目', async () => {
    const authFile = await tmpAuthFile();
    await fs.writeFile(authFile, AUTH_JSON);
    await saveAuthKey({ key: 'sk-openai', provider: 'openai', authFile });
    const raw = JSON.parse(await fs.readFile(authFile, 'utf8'));
    expect(raw.deepseek.key).toBe('sk-from-file');
    expect(raw.openai.key).toBe('sk-openai');
  });
});

describe('resolveBaseUrl', () => {
  it('DSCODE_BASE_URL 覆盖默认网关（FR-1.3）', () => {
    expect(resolveBaseUrl({ DSCODE_BASE_URL: 'https://proxy.example.com' })).toBe('https://proxy.example.com');
    expect(resolveBaseUrl({})).toBe('https://api.deepseek.com');
  });

  it('兼容旧变量 DSAPI_BASE_URL', () => {
    expect(resolveBaseUrl({ DSAPI_BASE_URL: 'https://legacy.example.com' })).toBe('https://legacy.example.com');
  });
});
