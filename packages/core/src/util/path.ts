/**
 * 路径安全（原理-file-tools.md §7、架构文档 §6 路径保护）。
 * 所有文件工具共用的路径白名单层：拒绝逃逸出工作目录的路径。
 */

import path from 'node:path';

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

/**
 * 把用户提供的路径规范化到 base 之内。
 * - 拒绝 `..` 逃逸（解析后落在 base 之外）
 * - 拒绝指向 base 之外的绝对路径
 * - 符号链接逃逸不做词法检查（v1 内由权限 deny 兜底，见 原理-沙盒执行.md §5）
 */
export function resolveWithin(base: string, userPath: string): string {
  const resolved = path.resolve(base, userPath);
  const baseResolved = path.resolve(base);
  const rel = path.relative(baseResolved, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathError(`路径逃逸被拒绝: ${userPath}`);
  }
  return resolved;
}

/** 校验 base 存在且为目录；否则抛错（工具执行前调用） */
export async function assertDirectory(base: string): Promise<void> {
  const { stat } = await import('node:fs/promises');
  const st = await stat(base);
  if (!st.isDirectory()) {
    throw new Error(`cwd 不是目录: ${base}`);
  }
}

/**
 * 工具友好的路径解析：不抛异常，返回 { path } 或 { error }。
 * 工具在 execute 内应优先用它，把逃逸拒绝转为 isError 结果而非 reject。
 */
export function tryResolve(base: string, userPath: string): { path: string } | { error: string } {
  try {
    return { path: resolveWithin(base, userPath) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
