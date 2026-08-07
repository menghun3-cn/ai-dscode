import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager, dscodeHome, hashCwd } from './manager.js';
import { newEntryId, type SessionEntry } from './entries.js';

let tmp: string;
let home: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-sess-mgr-'));
  home = path.join(tmp, 'dscode-home');
  process.env['DSCODE_HOME'] = home;
});

afterAll(async () => {
  delete process.env['DSCODE_HOME'];
  await fs.rm(tmp, { recursive: true, force: true });
});

function makeEntry(type: SessionEntry['type'], overrides: Partial<SessionEntry> = {}): SessionEntry {
  return { id: newEntryId('t'), parentId: null, type, timestamp: Date.now(), ...overrides } as SessionEntry;
}

describe('SessionManager（原理-session.md §2/§5）', () => {
  it('dscodeHome 支持 DSCODE_HOME 覆盖', () => {
    // 返回 env 原值（路径归一化由调用方 path.join 完成）
    expect(dscodeHome({ DSCODE_HOME: '/x' })).toBe('/x');
    expect(dscodeHome({})).toBe(path.join(os.homedir(), '.dscode'));
  });

  it('hashCwd 稳定且按目录区分', () => {
    expect(hashCwd('/a/b')).toBe(hashCwd('/a/b'));
    expect(hashCwd('/a/b')).not.toBe(hashCwd('/a/c'));
  });

  it('create + append + read 往返（JSONL 每行可 parse，SC-2.1）', async () => {
    const mgr = new SessionManager(tmp);
    const id = await mgr.create();
    await mgr.append(id, makeEntry('user', { content: '你好' }));
    await mgr.append(id, makeEntry('assistant', { content: '收到', role: 'assistant' }));
    const entries = await mgr.read(id);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.content).toBe('你好');
    expect(entries[1]!.type).toBe('assistant');
    // 文件每行合法 JSON（SC-2.1 判据）
    const raw = await fs.readFile(path.join(home, 'sessions', hashCwd(tmp), `${id}.jsonl`), 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  it('损坏行跳过，不整文件崩溃（崩溃弹性）', async () => {
    const mgr = new SessionManager(tmp);
    const id = await mgr.create();
    await mgr.append(id, makeEntry('user', { content: 'a' }));
    // 手工写入半行
    const file = path.join(home, 'sessions', hashCwd(tmp), `${id}.jsonl`);
    await fs.appendFile(file, '{"broken":\n', 'utf8');
    await mgr.append(id, makeEntry('assistant', { content: 'b', role: 'assistant' }));
    const entries = await mgr.read(id);
    expect(entries.map((e) => e.content)).toEqual(['a', 'b']);
  });

  it('list / latestId 按 mtime 倒序', async () => {
    const mgr = new SessionManager(tmp);
    const a = await mgr.create([makeEntry('user', { content: 'a' })]);
    await new Promise((r) => setTimeout(r, 5)); // 确保 mtime 严格递增（避免同毫秒竞态）
    const b = await mgr.create([makeEntry('user', { content: 'b' })]);
    const list = await mgr.list();
    expect(list.map((m) => m.id)).toContain(a);
    expect(list.map((m) => m.id)).toContain(b);
    expect(list[0]!.id).toBe(b); // 后创建的 mtime 更大
    expect(await mgr.latestId()).toBe(b);
  });

  it('list 带 /name 会话名（取最后一个 label entry，M2 P1 检索）', async () => {
    const mgr = new SessionManager(tmp);
    const id = await mgr.create();
    await mgr.append(id, makeEntry('user', { content: 'a' }));
    await mgr.append(id, makeEntry('label', { name: '重构会话' }));
    const meta = (await mgr.list()).find((m) => m.id === id);
    expect(meta?.name).toBe('重构会话');
  });

  it('fork 语义：create(path) 生成新文件，旧文件不变（SC-2.4 数据层）', async () => {
    const mgr = new SessionManager(tmp);
    const oldId = await mgr.create();
    await mgr.append(oldId, makeEntry('user', { content: '原始' }));
    const oldRaw = await fs.readFile(path.join(home, 'sessions', hashCwd(tmp), `${oldId}.jsonl`), 'utf8');

    // fork = 用分支 entries create 新会话（模拟 forkFrom 的数据层）
    const branch = await mgr.read(oldId);
    const forkId = await mgr.create(branch);

    expect(forkId).not.toBe(oldId);
    const newRaw = await fs.readFile(path.join(home, 'sessions', hashCwd(tmp), `${forkId}.jsonl`), 'utf8');
    expect(newRaw).toBe(oldRaw); // 内容一致
    // 旧文件未被改动
    const oldRaw2 = await fs.readFile(path.join(home, 'sessions', hashCwd(tmp), `${oldId}.jsonl`), 'utf8');
    expect(oldRaw2).toBe(oldRaw);
  });
});
