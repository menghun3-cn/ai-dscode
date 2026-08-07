/**
 * 权限引擎（架构文档 §4.2.5、todos M5-S1、SC-4.3）。
 * - 危险命令二次确认：rm -rf / sudo / git push --force 等始终确认（除 full-auto + allow）
 * - 允许/拒绝列表持久化 ~/.dscode/permissions.json（M5 P1：重启规则保留）
 * - 非交互（无 confirm 回调）→ 默认拒绝（安全兜底，见 原理-plan-and-execute.md §4.3）
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dscodeHome } from '../session/manager.js';

/** 危险命令模式（命中即需确认） */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-rf|-fr)\b/, why: 'rm -rf 递归强制删除' },
  { pattern: /\brm\s+-[a-zA-Z]*f\s+.*\/\s*$/, why: 'rm -f 目录' },
  { pattern: /\bsudo\b/, why: 'sudo 提权' },
  { pattern: /\bgit\s+push\s+.*(--force|-f)\b/, why: 'git push --force 覆盖远端' },
  { pattern: /\bmkfs\b/, why: '格式化磁盘' },
  { pattern: /\bdd\s+if=.*of=\/dev\b/, why: 'dd 写裸设备' },
  { pattern: /\bshutdown\b|\bpoweroff\b|\breboot\b/, why: '关机/重启' },
  { pattern: /\bcurl[^|]*\|\s*(sudo\s+)?(bash|sh)\b/, why: 'curl 管道执行远程脚本' },
];

/** 是否为危险命令（纯函数，便于单测） */
export function isDangerousCommand(command: string): string | null {
  for (const { pattern, why } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return why;
  }
  return null;
}

export interface PermissionRules {
  allow: string[];
  deny: string[];
}

function rulesPath(env: Record<string, string | undefined> = process.env): string {
  return path.join(dscodeHome(env), 'permissions.json');
}

async function readRules(env: Record<string, string | undefined> = process.env): Promise<PermissionRules> {
  try {
    const raw = await fs.readFile(rulesPath(env), 'utf8');
    const parsed = JSON.parse(raw) as PermissionRules;
    return { allow: parsed.allow ?? [], deny: parsed.deny ?? [] };
  } catch {
    return { allow: [], deny: [] };
  }
}

async function writeRules(rules: PermissionRules, env: Record<string, string | undefined> = process.env): Promise<void> {
  await fs.mkdir(path.dirname(rulesPath(env)), { recursive: true });
  await fs.writeFile(rulesPath(env), `${JSON.stringify(rules, null, 2)}\n`, 'utf8');
}

/** 追加一条 allow/deny 规则（如 `bash:rm -rf node_modules`）并持久化（M5 P1） */
export async function addPermissionRule(kind: 'allow' | 'deny', rule: string): Promise<void> {
  const rules = await readRules();
  const list = kind === 'allow' ? rules.allow : rules.deny;
  if (!list.includes(rule)) list.push(rule);
  await writeRules(rules);
}

export interface PermissionVerdict {
  allow: boolean;
  /** 拒绝/需要确认的原因 */
  reason?: string;
  /** 是否需要用户确认（二次确认场景） */
  confirm?: boolean;
}

export interface PermissionEngineOptions {
  /** 二次确认回调（CLI/TUI 注入）；无则默认拒绝 */
  confirm?: (message: string) => Promise<boolean>;
  /** full-auto 模式：跳过二次确认（仅受 allow 列表约束） */
  autoApprove?: boolean;
  env?: Record<string, string | undefined>;
}

export class PermissionEngine {
  private readonly confirm?: (message: string) => Promise<boolean>;
  private readonly autoApprove: boolean;
  private readonly env: Record<string, string | undefined>;
  private rules?: PermissionRules;

  constructor(opts: PermissionEngineOptions = {}) {
    this.confirm = opts.confirm;
    this.autoApprove = opts.autoApprove ?? false;
    this.env = opts.env ?? process.env;
  }

  private async getRules(): Promise<PermissionRules> {
    if (!this.rules) this.rules = await readRules(this.env);
    return this.rules;
  }

  /**
   * 检查操作是否放行。
   * @param subject 操作标识（如 `bash:rm -rf node_modules`，`write:.env`）
   */
  async check(subject: string, opts: { dangerousReason?: string } = {}): Promise<PermissionVerdict> {
    const rules = await this.getRules();
    // 显式拒绝优先
    if (rules.deny.some((r) => subject.startsWith(r))) {
      return { allow: false, reason: `被拒绝规则命中: ${subject}` };
    }
    // 显式允许放行（不再确认）
    if (rules.allow.some((r) => subject.startsWith(r))) {
      return { allow: true };
    }
    // 危险操作：需要二次确认（除 full-auto + allow）
    if (opts.dangerousReason) {
      if (this.autoApprove) return { allow: true }; // full-auto
      if (!this.confirm) return { allow: false, reason: `危险操作需要确认: ${opts.dangerousReason}（${subject}）` };
      const ok = await this.confirm(`⚠️ 危险操作确认：${opts.dangerousReason}\n  命令: ${subject}\n  确认执行？(y/N)`);
      return ok ? { allow: true } : { allow: false, reason: `已拒绝危险操作: ${subject}` };
    }
    return { allow: true };
  }
}
