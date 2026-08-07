/**
 * project_trust（架构文档 §6、todos M4-S4）。
 * 项目扩展 `.dscode/extensions` 需显式信任才加载；信任记录在 ~/.dscode/trust.json。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dscodeHome } from '../session/manager.js';

function trustStorePath(env: Record<string, string | undefined> = process.env): string {
  return path.join(dscodeHome(env), 'trust.json');
}

/** 项目是否已信任 */
export async function isProjectTrusted(cwd: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  try {
    const raw = await fs.readFile(trustStorePath(env), 'utf8');
    const parsed = JSON.parse(raw) as { projects?: string[] };
    return (parsed.projects ?? []).includes(path.resolve(cwd));
  } catch {
    return false;
  }
}

/** 标记项目为已信任 */
export async function trustProject(cwd: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  const store = trustStorePath(env);
  let projects: string[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(store, 'utf8')) as { projects?: string[] };
    projects = parsed.projects ?? [];
  } catch {
    // 新建
  }
  const resolved = path.resolve(cwd);
  if (!projects.includes(resolved)) projects.push(resolved);
  await fs.mkdir(path.dirname(store), { recursive: true });
  await fs.writeFile(store, `${JSON.stringify({ projects }, null, 2)}\n`, 'utf8');
}
