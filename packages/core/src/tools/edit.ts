/**
 * edit 工具（原理-file-tools.md §4、需求 FR-3.3、todos M1-S3）。
 * - 单次多 disjoint edit（一次调用可含多个替换）
 * - oldText 全文唯一匹配：未命中 / 命中多次 → 报错，不猜测
 * - 重叠检测：多个 edit 区间重叠 → 报错（防前一个替换改坏后一个的锚点）
 */

import { promises as fs } from 'node:fs';
import { Type, type Static } from '@sinclair/typebox';
import type { Tool } from '../tool.js';
import { resolveWithin } from '../util/path.js';
import { unifiedDiff } from '../util/diff.js';

export const editParams = Type.Object({
  path: Type.String({ description: '目标文件路径（相对 cwd 或绝对路径）' }),
  edits: Type.Array(
    Type.Object({
      oldText: Type.String({ description: '待替换的原文（必须全文唯一匹配）' }),
      newText: Type.String({ description: '替换后的文本' }),
    }),
    { description: '多个互不重叠的编辑' },
  ),
});

export type EditParams = Static<typeof editParams>;

interface Span {
  start: number;
  end: number;
  oldText: string;
  newText: string;
}

export const editTool: Tool<EditParams> = {
  name: 'edit',
  description: '精确文本替换。oldText 必须在文件中唯一出现，一次可提交多个互不重叠的编辑。',
  parameters: editParams,

  async execute(_toolCallId, params, ctx) {
    const filePath = resolveWithin(ctx.cwd, params.path);
    const content = await fs.readFile(filePath, 'utf8').catch(() => null);
    if (content === null) {
      return { output: `文件不存在: ${params.path}`, isError: true };
    }

    // 1. 定位所有编辑区间（含唯一性校验）
    const spans: Span[] = [];
    for (const e of params.edits) {
      const first = content.indexOf(e.oldText);
      if (first === -1) {
        return { output: `oldText 未命中: ${JSON.stringify(e.oldText)}`, isError: true };
      }
      const second = content.indexOf(e.oldText, first + 1);
      if (second !== -1) {
        return { output: `oldText 命中多次（${JSON.stringify(e.oldText)}），请提供更长上下文`, isError: true };
      }
      spans.push({ start: first, end: first + e.oldText.length, oldText: e.oldText, newText: e.newText });
    }

    // 2. 重叠检测
    spans.sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) {
      if (spans[i]!.start < spans[i - 1]!.end) {
        return { output: `编辑区间重叠：${JSON.stringify(spans[i - 1]!.oldText)} 与 ${JSON.stringify(spans[i]!.oldText)}`, isError: true };
      }
    }

    // 3. 从后往前应用，避免位移干扰
    let result = content;
    for (let i = spans.length - 1; i >= 0; i--) {
      const s = spans[i]!;
      result = result.slice(0, s.start) + s.newText + result.slice(s.end);
    }
    await fs.writeFile(filePath, result, 'utf8');

    // 改前 vs 改后 diff（原理-file-tools.md §6：每次 patch 后必有 diff 快照，可对账）
    const diff = unifiedDiff(content, result, { label: params.path });
    const statText = diff.stats.added + diff.stats.removed > 0 ? `（+${diff.stats.added} -${diff.stats.removed}）` : '';
    return {
      output: `已应用 ${spans.length} 个编辑到 ${params.path}${statText}`,
      metadata: { edits: spans.length, path: filePath, diff: diff.text, diffStats: diff.stats },
    };
  },
};
