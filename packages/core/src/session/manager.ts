/**
 * SessionManager（原理-session.md §2/§5、架构文档 §4.2.3）。
 * - 存储：`~/.dscode/sessions/<cwd-hash>/<session-id>.jsonl`（DSCODE_HOME 可覆盖）
 * - JSONL 追加写：每行一个 entry，不重写全文（崩溃最多丢最后半行）
 * - 损坏恢复：读到非法行跳过，不整文件崩溃
 * - 树状结构：靠 parentId 连成树，本文件提供 tree 基础操作
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import type { SessionEntry } from './entries.js';

/** 数据根目录：DSCODE_HOME env 覆盖（默认 ~/.dscode） */
export function dscodeHome(env: Record<string, string | undefined> = process.env): string {
  return env['DSCODE_HOME'] ?? path.join(os.homedir(), '.dscode');
}

/** cwd 的稳定 hash（sha256 前 12 位），同一仓库的会话聚在一起 */
export function hashCwd(cwd: string): string {
  return createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 12);
}

export interface SessionMeta {
  id: string;
  /** 最后修改时间戳 */
  mtime: number;
  /** entry 数（用于列表展示） */
  entries: number;
}

export class SessionManager {
  constructor(private readonly cwd: string) {}

  private dir(): string {
    return path.join(dscodeHome(), 'sessions', hashCwd(this.cwd));
  }

  private file(id: string): string {
    return path.join(this.dir(), `${id}.jsonl`);
  }

  /** 列出当前 cwd 下全部会话（按 mtime 倒序） */
  async list(): Promise<SessionMeta[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir());
    } catch {
      return [];
    }
    const metas: SessionMeta[] = [];
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -'.jsonl'.length);
      const full = path.join(this.dir(), name);
      try {
        const st = await fs.stat(full);
        const entries = await this.countEntries(full);
        metas.push({ id, mtime: st.mtimeMs, entries });
      } catch {
        // 跳过读不到的
      }
    }
    metas.sort((a, b) => b.mtime - a.mtime);
    return metas;
  }

  /** 最近一个会话 id（`dscode -c` 用）；无则 null */
  async latestId(): Promise<string | null> {
    const list = await this.list();
    return list[0]?.id ?? null;
  }

  /** 读取全部 entry；损坏行跳过并返回可读列表 */
  async read(id: string): Promise<SessionEntry[]> {
    const raw = await fs.readFile(this.file(id), 'utf8').catch(() => null);
    if (raw === null) return [];
    const entries: SessionEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as SessionEntry);
      } catch {
        // 半行/损坏：跳过（崩溃弹性）
      }
    }
    return entries;
  }

  /** 追加一个 entry（自动建目录） */
  async append(id: string, entry: SessionEntry): Promise<void> {
    await fs.mkdir(this.dir(), { recursive: true });
    await fs.appendFile(this.file(id), `${JSON.stringify(entry)}\n`, 'utf8');
  }

  /** 创建新会话文件（可带初始 entries），返回新 session id */
  async create(entries: SessionEntry[] = []): Promise<string> {
    const id = randomUUID();
    if (entries.length > 0) {
      await fs.mkdir(this.dir(), { recursive: true });
      const lines = entries.map((e) => JSON.stringify(e)).join('\n');
      await fs.writeFile(this.file(id), `${lines}\n`, 'utf8');
    }
    return id;
  }

  private async countEntries(full: string): Promise<number> {
    const raw = await fs.readFile(full, 'utf8').catch(() => '');
    return raw.split('\n').filter((l) => l.trim().length > 0).length;
  }
}
