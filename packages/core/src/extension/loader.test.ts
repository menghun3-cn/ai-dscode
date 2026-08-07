import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventBus } from './bus.js';
import { ExtensionManager, discoverExtensions } from './loader.js';
import { trustProject } from './trust.js';

let tmp: string;
let home: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-loader-'));
  home = path.join(tmp, 'dscode-home');
  process.env['DSCODE_HOME'] = home;
});

afterAll(async () => {
  delete process.env['DSCODE_HOME'];
  await fs.rm(tmp, { recursive: true, force: true });
});

const EXT_GREET = `export default function (dscode) {
  dscode.registerTool({ name: 'greet', description: '打招呼', parameters: {}, execute: async (p) => ({ output: 'Hello, ' + (p.name ?? 'world') + '!' }) });
  dscode.registerCommand({ name: 'hello', handler: () => 'world' });
}`;

describe('ExtensionManager（todos M4-S3：jiti 加载 + 位置 + trust）', () => {
  it('全局扩展加载并注册工具/命令', async () => {
    const extDir = path.join(home, 'extensions');
    await fs.mkdir(extDir, { recursive: true });
    await fs.writeFile(path.join(extDir, 'greet.ts'), EXT_GREET, 'utf8');
    const mgr = new ExtensionManager({ cwd: tmp, bus: new EventBus() });
    await mgr.loadAll();
    expect(mgr.getApis()).toHaveLength(1);
    expect(mgr.getTools().map((t) => t.name)).toContain('greet');
    expect(mgr.getCommands().map((c) => c.name)).toContain('hello');
    expect(mgr.getErrors()).toHaveLength(0);
  });

  it('项目扩展：未信任不加载且记录错误，信任后加载', async () => {
    const proj = path.join(tmp, 'proj');
    await fs.mkdir(path.join(proj, '.dscode', 'extensions'), { recursive: true });
    await fs.writeFile(path.join(proj, '.dscode', 'extensions', 'g.ts'), EXT_GREET, 'utf8');

    // 未信任：项目扩展不加载（全局扩展正常加载），错误记录项目文件
    const mgrUntrusted = new ExtensionManager({ cwd: proj, bus: new EventBus(), trustPrompt: async () => false });
    await mgrUntrusted.loadAll();
    expect(mgrUntrusted.getErrors().some((e) => e.file.includes('extensions') && e.message.includes('未信任'))).toBe(true);

    // 信任后：项目扩展也加载
    await trustProject(proj);
    const mgrTrusted = new ExtensionManager({ cwd: proj, bus: new EventBus() });
    await mgrTrusted.loadAll();
    expect(mgrTrusted.getApis().length).toBeGreaterThanOrEqual(2); // 全局 + 项目
  });

  it('reload：热重载后新工具生效', async () => {
    const extDir = path.join(home, 'extensions');
    const file = path.join(extDir, 'reloadable.ts');
    await fs.writeFile(file, `export default function (d) { d.registerTool({ name: 'v1', description: '', parameters: {}, execute: async () => ({ output: 'v1' }) }); }`, 'utf8');
    const mgr = new ExtensionManager({ cwd: tmp, bus: new EventBus() });
    await mgr.loadAll();
    expect(mgr.getTools().some((t) => t.name === 'v1')).toBe(true);

    // 改文件后 reload
    await fs.writeFile(file, `export default function (d) { d.registerTool({ name: 'v2', description: '', parameters: {}, execute: async () => ({ output: 'v2' }) }); }`, 'utf8');
    await mgr.loadAll(); // 等价 /reload
    const tools = mgr.getTools();
    expect(tools.some((t) => t.name === 'v2')).toBe(true);
    expect(tools.some((t) => t.name === 'v1')).toBe(false); // 旧工具被替换
  });

  it('discoverExtensions：全局 + 项目位置', async () => {
    const files = await discoverExtensions(tmp);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.scope === 'global')).toBe(true);
  });
});
