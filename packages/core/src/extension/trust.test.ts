import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isProjectTrusted, trustProject } from './trust.js';

let tmp: string;
let home: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-trust-'));
  home = path.join(tmp, 'dscode-home');
  process.env['DSCODE_HOME'] = home;
});

afterAll(async () => {
  delete process.env['DSCODE_HOME'];
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('project_trust（todos M4-S4）', () => {
  it('默认未信任', async () => {
    expect(await isProjectTrusted(path.join(tmp, 'proj'))).toBe(false);
  });

  it('trustProject 后信任，trust.json 落盘', async () => {
    const cwd = path.join(tmp, 'proj');
    await fs.mkdir(cwd, { recursive: true });
    await trustProject(cwd);
    expect(await isProjectTrusted(cwd)).toBe(true);
    const raw = JSON.parse(await fs.readFile(path.join(home, 'trust.json'), 'utf8'));
    expect(raw.projects).toContain(path.resolve(cwd));
  });

  it('不同项目互不影响', async () => {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    await fs.mkdir(a, { recursive: true });
    await fs.mkdir(b, { recursive: true });
    await trustProject(a);
    expect(await isProjectTrusted(a)).toBe(true);
    expect(await isProjectTrusted(b)).toBe(false);
  });
});
