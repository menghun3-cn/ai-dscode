/**
 * System prompt 组装（架构文档 §4.2.7、todos M1-S4）。
 * 组装顺序：角色 → 工具 snippets → steering 文件 → DSCODE.md → 用户/flag 追加。
 * DSCODE_DEBUG=1 时把组装结果打到 stderr（NFR-4 观测）。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Tool } from '../tool.js';

export interface SystemPromptInput {
  /** 角色描述（默认中文 dscode 角色） */
  role?: string;
  /** 全部可用工具（生成 snippets） */
  tools: Tool[];
  /** 当前工作目录（找 DSCODE.md 与 .dscode/steering/） */
  cwd: string;
  /** 用户/flag 追加内容 */
  extra?: string;
  debug?: boolean;
}

const DEFAULT_ROLE =
  '你是 dscode，一个运行在终端里的 AI 编码助手。你通过调用工具读写文件、搜索代码、执行命令来完成任务。' +
  '默认用中文回答。工具执行失败时，读报错、换思路重试，直到任务收敛。';

export async function assembleSystemPrompt(input: SystemPromptInput): Promise<string> {
  const parts: string[] = [input.role ?? DEFAULT_ROLE];

  // 工具 snippets（简明清单；完整 schema 由 provider 的 tools 参数携带）
  if (input.tools.length > 0) {
    parts.push(`可用工具：${input.tools.map((t) => `${t.name}（${t.description}）`).join('；')}`);
  }

  // steering 文件（.dscode/steering/*.md，按文件名排序）
  const steeringDir = path.join(input.cwd, '.dscode', 'steering');
  const steering = await readDirTexts(steeringDir);
  if (steering.length > 0) {
    parts.push(`## 项目 steering\n${steering.join('\n\n')}`);
  }

  // DSCODE.md（项目指令，对标 CLAUDE.md/AGENTS.md）
  const dscodeMd = await readOptional(path.join(input.cwd, 'DSCODE.md'));
  if (dscodeMd !== null) {
    parts.push(`## DSCODE.md（项目指令）\n${dscodeMd}`);
  }

  if (input.extra) parts.push(input.extra);

  const prompt = parts.join('\n\n');
  if (input.debug) {
    // eslint-disable-next-line no-console
    console.error(`[dscode:debug] system prompt:\n${prompt}`);
  }
  return prompt;
}

async function readDirTexts(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .sort((a, b) => a.name.localeCompare(b.name));
    const out: string[] = [];
    for (const f of files) {
      const text = await fs.readFile(path.join(dir, f.name), 'utf8').catch(() => null);
      if (text !== null) out.push(text);
    }
    return out;
  } catch {
    return [];
  }
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}
