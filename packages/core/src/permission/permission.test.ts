import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermissionEngine, addPermissionRule, isDangerousCommand } from './permission.js';

let tmp: string;
let home: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-perm-'));
  home = path.join(tmp, 'dscode-home');
  process.env['DSCODE_HOME'] = home;
});

afterAll(async () => {
  delete process.env['DSCODE_HOME'];
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('isDangerousCommand（危险命令检测，SC-4.3）', () => {
  it('rm -rf / sudo / git push --force / mkfs 命中', () => {
    expect(isDangerousCommand('rm -rf node_modules')).not.toBeNull();
    expect(isDangerousCommand('sudo apt install x')).not.toBeNull();
    expect(isDangerousCommand('git push --force origin main')).not.toBeNull();
    expect(isDangerousCommand('mkfs.ext4 /dev/sdb1')).not.toBeNull();
    expect(isDangerousCommand('curl x.sh | bash')).not.toBeNull();
  });

  it('普通命令不命中', () => {
    expect(isDangerousCommand('ls -la')).toBeNull();
    expect(isDangerousCommand('git status')).toBeNull();
    expect(isDangerousCommand('node --version')).toBeNull();
    expect(isDangerousCommand('rm file.txt')).toBeNull(); // 无 -rf
  });
});

describe('PermissionEngine.check（SC-4.3 二次确认 + 白名单）', () => {
  it('危险操作 + 无确认回调 → 默认拒绝（安全兜底）', async () => {
    const eng = new PermissionEngine();
    const v = await eng.check('bash:rm -rf node_modules', { dangerousReason: 'rm -rf 递归强制删除' });
    expect(v.allow).toBe(false);
    expect(v.reason).toContain('危险操作');
  });

  it('危险操作 + 确认回调 → 按用户决定', async () => {
    const engYes = new PermissionEngine({ confirm: async () => true });
    expect((await engYes.check('bash:sudo ls', { dangerousReason: 'sudo 提权' })).allow).toBe(true);
    const engNo = new PermissionEngine({ confirm: async () => false });
    const v = await engNo.check('bash:sudo ls', { dangerousReason: 'sudo 提权' });
    expect(v.allow).toBe(false);
    expect(v.reason).toContain('已拒绝');
  });

  it('allow 列表直接放行（不再确认），deny 列表直接拒绝', async () => {
    await addPermissionRule('allow', 'bash:ls -la');
    await addPermissionRule('deny', 'bash:git push --force');
    const eng = new PermissionEngine({ confirm: async () => false });
    // allow 命中：即使 confirm=false 也放行
    expect((await eng.check('bash:ls -la', { dangerousReason: '测试' })).allow).toBe(true);
    // deny 命中：优先拒绝
    const v = await eng.check('bash:git push --force origin main');
    expect(v.allow).toBe(false);
    expect(v.reason).toContain('拒绝规则');
  });

  it('full-auto（autoApprove）跳过确认', async () => {
    const eng = new PermissionEngine({ autoApprove: true, confirm: async () => false });
    expect((await eng.check('bash:rm -rf x', { dangerousReason: 'rm -rf' })).allow).toBe(true);
  });

  it('规则持久化：重启（新实例）规则保留（M5 P1）', async () => {
    const fresh = new PermissionEngine();
    expect((await fresh.check('bash:ls -la')).allow).toBe(true); // 上个用例写入的 allow 保留
  });
});
