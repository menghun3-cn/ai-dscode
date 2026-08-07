/**
 * 扩展加载器（架构文档 §4.2.8、todos M4-S3）。
 * - 位置：全局 `~/.dscode/extensions/*.ts` + 项目 `.dscode/extensions/*.ts`
 * - 加载：jiti（TS 原生，免编译）；默认导出 `export default function (dscode) {...}`
 * - 项目扩展需 project_trust（未信任不加载，可注入 trustPrompt 交互确认）
 * - hot reload：reload() 清空重载（/reload 命令用）
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createJiti } from 'jiti';
import { EventBus } from './bus.js';
import { ExtensionApi, type ExtensionFactory } from './api.js';
import type { ExtensionToolDef, ExtensionCommandDef, ExtensionShortcutDef, ExtensionFlagDef } from './api.js';
import { consoleUi, type ExtensionUi } from './ui.js';
import { isProjectTrusted } from './trust.js';

export interface ExtensionFile {
  /** 绝对路径 */
  path: string;
  /** global=全局扩展；project=项目扩展 */
  scope: 'global' | 'project';
}

/** 发现扩展文件：全局 + 项目（项目需信任才进 loader 决策） */
export async function discoverExtensions(cwd: string, env: Record<string, string | undefined> = process.env): Promise<ExtensionFile[]> {
  const files: ExtensionFile[] = [];
  const home = env['DSCODE_HOME'] ?? path.join(os.homedir(), '.dscode');
  const globalDir = path.join(home, 'extensions');
  const projectDir = path.join(cwd, '.dscode', 'extensions');
  for (const [dir, scope] of [
    [globalDir, 'global'],
    [projectDir, 'project'],
  ] as const) {
    try {
      const names = await fs.readdir(dir);
      for (const name of names) {
        if (!name.endsWith('.ts') && !name.endsWith('.mjs') && !name.endsWith('.cjs') && !name.endsWith('.js')) continue;
        files.push({ path: path.join(dir, name), scope });
      }
    } catch {
      // 目录不存在：跳过
    }
  }
  return files;
}

export interface ExtensionManagerOptions {
  cwd: string;
  bus: EventBus;
  ui?: ExtensionUi;
  /** 项目扩展信任确认回调；返回 true 信任并加载。缺省：未信任则跳过 */
  trustPrompt?: (cwd: string) => Promise<boolean>;
}

export class ExtensionManager {
  private readonly cwd: string;
  private readonly bus: EventBus;
  private readonly ui: ExtensionUi;
  private readonly trustPrompt?: (cwd: string) => Promise<boolean>;
  private readonly jiti = createJiti(import.meta.url, { interopDefault: true });
  private apis: ExtensionApi[] = [];
  private errors: Array<{ file: string; message: string }> = [];

  constructor(opts: ExtensionManagerOptions) {
    this.cwd = opts.cwd;
    this.bus = opts.bus;
    this.ui = opts.ui ?? consoleUi;
    this.trustPrompt = opts.trustPrompt;
  }

  getApis(): ExtensionApi[] {
    return this.apis;
  }

  getErrors(): Array<{ file: string; message: string }> {
    return this.errors;
  }

  /** 加载全部扩展（可重复调用 reload）；清 jiti 缓存保证热重载生效 */
  async loadAll(): Promise<void> {
    this.apis = [];
    this.errors = [];
    // jiti v2 的 cache 是普通对象：逐键 delete 才是正确清缓存方式（无 clearCache/clear 方法）
    const cache = (this.jiti as { cache?: Record<string, unknown> }).cache;
    if (cache) for (const k of Object.keys(cache)) delete cache[k];
    const files = await discoverExtensions(this.cwd);
    for (const file of files) {
      try {
        if (file.scope === 'project' && !(await isProjectTrusted(this.cwd))) {
          const ok = this.trustPrompt ? await this.trustPrompt(this.cwd) : false;
          if (!ok) {
            this.errors.push({ file: file.path, message: '项目未信任，扩展未加载（/extensions 查看，dscode --trust 信任）' });
            continue;
          }
        }
        const mod = (await this.jiti.import(file.path)) as { default?: unknown } | undefined;
        const factory = mod?.default as ExtensionFactory | undefined;
        if (typeof factory !== 'function') {
          this.errors.push({ file: file.path, message: '扩展必须 default export 一个函数' });
          continue;
        }
        const api = new ExtensionApi({ bus: this.bus, ui: this.ui, extensionId: path.basename(file.path, path.extname(file.path)) });
        await factory(api);
        this.apis.push(api);
      } catch (err) {
        this.errors.push({ file: file.path, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  /** 聚合全部扩展的工具/命令/快捷键/flag */
  getTools(): ExtensionToolDef[] {
    return this.apis.flatMap((a) => a.getTools());
  }

  getCommands(): ExtensionCommandDef[] {
    return this.apis.flatMap((a) => a.getCommands());
  }

  getShortcuts(): ExtensionShortcutDef[] {
    return this.apis.flatMap((a) => a.getShortcuts());
  }

  getFlags(): ExtensionFlagDef[] {
    return this.apis.flatMap((a) => a.getFlags());
  }
}
