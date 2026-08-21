/**
 * 行级 unified diff（原理-file-tools.md §6：改前 vs 改后的对账审计）。
 * - 无第三方依赖：LCS 动态规划求最小编辑脚本，产出标准 unified diff（@@ hunk + 空格/-/+ 行）
 * - 有界回退：中间段行数乘积超 LCS_LIMIT 时退化为"整段删除+整段新增"，大文件不爆内存
 * - 掐头去尾公共行快路径：典型 edit 场景（局部改动）只对中间段做 DP
 */

export interface DiffStats {
  added: number;
  removed: number;
}

export interface UnifiedDiff {
  /** 完整 unified diff 文本（含 ---/+++ 文件头、@@ hunk、空格/-/+ 前缀行）；无差异时为空串 */
  text: string;
  stats: DiffStats;
}

/** 中间段 LCS 规模上限（行数乘积）；超出走有界回退，防 O(nm) 内存/耗时失控 */
const LCS_LIMIT = 1_000_000;

type Op =
  | { type: 'eq'; text: string }
  | { type: 'del'; text: string }
  | { type: 'add'; text: string };

/** 文本 → 行序列（去掉末尾换行产生的空行；"" → []） */
function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 掐头去尾公共行，只对中间段做 LCS；规模超限则整段替换 */
function diffLines(oldLines: string[], newLines: string[]): Op[] {
  let pre = 0;
  while (pre < oldLines.length && pre < newLines.length && oldLines[pre] === newLines[pre]) pre++;
  let suf = 0;
  while (
    suf < oldLines.length - pre &&
    suf < newLines.length - pre &&
    oldLines[oldLines.length - 1 - suf] === newLines[newLines.length - 1 - suf]
  ) {
    suf++;
  }

  const ops: Op[] = [];
  for (let i = 0; i < pre; i++) ops.push({ type: 'eq', text: oldLines[i]! });

  const midOld = oldLines.slice(pre, oldLines.length - suf);
  const midNew = newLines.slice(pre, newLines.length - suf);

  if (midOld.length * midNew.length > LCS_LIMIT) {
    for (const l of midOld) ops.push({ type: 'del', text: l });
    for (const l of midNew) ops.push({ type: 'add', text: l });
  } else {
    ops.push(...lcsOps(midOld, midNew));
  }

  for (let i = oldLines.length - suf; i < oldLines.length; i++) ops.push({ type: 'eq', text: oldLines[i]! });
  return ops;
}

/** LCS DP（Int32Array 扁平存储）+ 回溯 → 中间段最小编辑脚本 */
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    const cur = i * w;
    const prev = (i - 1) * w;
    for (let j = 1; j <= m; j++) {
      dp[cur + j] =
        a[i - 1] === b[j - 1]
          ? dp[prev + j - 1]! + 1
          : Math.max(dp[prev + j]!, dp[cur + j - 1]!);
    }
  }

  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ type: 'eq', text: a[i - 1]! });
      i--;
      j--;
    } else if (dp[(i - 1) * w + j]! > dp[i * w + j - 1]!) {
      ops.push({ type: 'del', text: a[i - 1]! });
      i--;
    } else {
      ops.push({ type: 'add', text: b[j - 1]! });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: 'del', text: a[i - 1]! });
    i--;
  }
  while (j > 0) {
    ops.push({ type: 'add', text: b[j - 1]! });
    j--;
  }
  return ops.reverse();
}

/** 编辑脚本 → hunk 文本 + 统计（变更区间扩 context 行，间距 ≤ 2×context 合并） */
function formatHunks(ops: Op[], context: number): { text: string; added: number; removed: number } {
  // 变更区间 [start, end)（连续非 eq 行）
  const changes: Array<[number, number]> = [];
  for (let i = 0; i < ops.length; ) {
    if (ops[i]!.type === 'eq') {
      i++;
      continue;
    }
    const start = i;
    while (i < ops.length && ops[i]!.type !== 'eq') i++;
    changes.push([start, i]);
  }
  if (changes.length === 0) return { text: '', added: 0, removed: 0 };

  // 扩 context 并合并相邻 hunk
  const hunks: Array<[number, number]> = [];
  for (const [s, e] of changes) {
    const hs = Math.max(0, s - context);
    const he = Math.min(ops.length, e + context);
    const last = hunks[hunks.length - 1];
    if (last && hs <= last[1]) {
      last[1] = he;
    } else {
      hunks.push([hs, he]);
    }
  }

  // 前缀计数：oldPrefix[i]/newPrefix[i] = ops[0..i) 中旧行/新行数（hunk 头行号计算用）
  const oldPrefix = new Int32Array(ops.length + 1);
  const newPrefix = new Int32Array(ops.length + 1);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    oldPrefix[i + 1] = oldPrefix[i]! + (op.type !== 'add' ? 1 : 0);
    newPrefix[i + 1] = newPrefix[i]! + (op.type !== 'del' ? 1 : 0);
  }

  const out: string[] = [];
  let added = 0;
  let removed = 0;
  for (const [hs, he] of hunks) {
    const oldCount = oldPrefix[he]! - oldPrefix[hs]!;
    const newCount = newPrefix[he]! - newPrefix[hs]!;
    // 空侧起始行号为 0（git 惯例：新文件 @@ -0,0 +1,N @@）；单行省略 ,1
    const oldStart = oldCount === 0 ? oldPrefix[hs]! : oldPrefix[hs]! + 1;
    const newStart = newCount === 0 ? newPrefix[hs]! : newPrefix[hs]! + 1;
    out.push(`@@ -${oldStart}${oldCount === 1 ? '' : `,${oldCount}`} +${newStart}${newCount === 1 ? '' : `,${newCount}`} @@`);
    for (let i = hs; i < he; i++) {
      const op = ops[i]!;
      if (op.type === 'eq') out.push(` ${op.text}`);
      else if (op.type === 'del') {
        out.push(`-${op.text}`);
        removed++;
      } else {
        out.push(`+${op.text}`);
        added++;
      }
    }
  }
  return { text: out.join('\n'), added, removed };
}

/** 计算 oldText → newText 的 unified diff（label 用于 ---/+++ 文件头，默认 'file'） */
export function unifiedDiff(
  oldText: string,
  newText: string,
  opts: { context?: number; label?: string } = {},
): UnifiedDiff {
  const context = opts.context ?? 3;
  const label = opts.label ?? 'file';
  const ops = diffLines(splitLines(oldText), splitLines(newText));
  const { text: hunkText, added, removed } = formatHunks(ops, context);
  if (!hunkText) return { text: '', stats: { added: 0, removed: 0 } };
  return {
    text: `--- a/${label}\n+++ b/${label}\n${hunkText}`,
    stats: { added, removed },
  };
}
