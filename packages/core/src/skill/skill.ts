/**
 * Skill 系统（原理-agentloop.md §7、todos M4-S6）。
 * skills 不常驻 system prompt——发现时渐进披露：`/skill:<name>` 显式触发，
 * 加载对应 markdown 指令注入上下文。
 * 位置：全局 `~/.dscode/skills/*.md` + 项目 `.dscode/skills/*.md`。
 * 说明：skill 只是 prompt 文本（不执行代码），风险低于扩展，故不强制 project_trust。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface Skill {
  name: string;
  content: string;
}

export class SkillManager {
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;

  constructor(opts: { cwd: string; env?: Record<string, string | undefined> }) {
    this.cwd = opts.cwd;
    this.env = opts.env ?? process.env;
  }

  private globalDir(): string {
    return path.join(this.env['DSCODE_HOME'] ?? path.join(os.homedir(), '.dscode'), 'skills');
  }

  private projectDir(): string {
    return path.join(this.cwd, '.dscode', 'skills');
  }

  private dirs(): string[] {
    return [this.globalDir(), this.projectDir()];
  }

  /** 列出全部可用 skill 名（全局 + 项目，去重） */
  async list(): Promise<string[]> {
    const names = new Set<string>();
    for (const dir of this.dirs()) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.endsWith('.md')) names.add(e.name.slice(0, -'.md'.length));
        }
      } catch {
        // 目录不存在
      }
    }
    return [...names].sort();
  }

  /** 加载 skill 内容；不存在返回 null */
  async load(name: string): Promise<Skill | null> {
    if (!/^[\w.-]+$/.test(name)) return null; // 防路径穿越
    for (const dir of this.dirs()) {
      const file = path.join(dir, `${name}.md`);
      try {
        const content = await fs.readFile(file, 'utf8');
        return { name, content };
      } catch {
        // 继续找下一个位置
      }
    }
    return null;
  }
}
