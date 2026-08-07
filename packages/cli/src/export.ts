/**
 * 会话导出（需求 FR-5.5、todos M2 P1）。
 * 把当前激活分支渲染成可读的 markdown / HTML：
 * 含会话 ID、会话名（label）、导出时间、模型切换记录、每节点时间戳。
 */

import type { SessionEntry } from '@dscode/core';

export interface ExportInput {
  sessionId: string;
  /** 激活分支（根在前） */
  branch: SessionEntry[];
}

function sessionName(branch: SessionEntry[]): string | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i]!.type === 'label' && branch[i]!.name) return branch[i]!.name;
  }
  return undefined;
}

function fmtTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 渲染单条 entry 为 {role, title, body}，供 markdown/html 共用 */
function renderEntry(e: SessionEntry): { role: string; title: string; body: string } | null {
  switch (e.type) {
    case 'user':
      return { role: '用户', title: `用户 · ${fmtTime(e.timestamp)}`, body: e.content ?? '' };
    case 'assistant':
      return { role: '助手', title: `助手 · ${fmtTime(e.timestamp)}`, body: e.content ?? '' };
    case 'toolResult':
      return { role: '工具', title: `工具结果 · ${fmtTime(e.timestamp)}`, body: e.content ?? '' };
    case 'compaction':
      return { role: '压缩', title: `压缩摘要 · ${fmtTime(e.timestamp)}`, body: e.content ?? '' };
    case 'modelChange':
      return { role: '模型', title: `模型切换 · ${fmtTime(e.timestamp)}`, body: `→ ${e.name ?? ''}` };
    default:
      return null; // branchSummary / label / extension 不单列
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** markdown 导出 */
export function renderSessionMarkdown(input: ExportInput): string {
  const name = sessionName(input.branch);
  const lines = [
    `# dscode 会话导出`,
    ``,
    `- 会话 ID: ${input.sessionId}`,
    name ? `- 会话名: ${name}` : null,
    `- 导出时间: ${new Date().toISOString()}`,
    `- 节点数: ${input.branch.length}`,
    ``,
    `## 对话`,
    ``,
  ].filter((l) => l !== null) as string[];

  for (const e of input.branch) {
    const r = renderEntry(e);
    if (!r) continue;
    lines.push(`### ${r.title}`, '', r.body, '');
  }
  return lines.join('\n');
}

/** HTML 导出 */
export function renderSessionHtml(input: ExportInput): string {
  const name = sessionName(input.branch);
  const blocks = input.branch
    .map((e) => renderEntry(e))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map(
      (r) =>
        `<div class="entry entry-${escapeHtml(r.role)}">` +
        `<div class="meta">${escapeHtml(r.title)}</div>` +
        `<div class="body"><pre>${escapeHtml(r.body)}</pre></div>` +
        `</div>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dscode 会话${name ? `：${escapeHtml(name)}` : ''}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; }
  .meta { color: #666; font-size: .85rem; margin-top: 1rem; }
  .body pre { background: #f6f8fa; padding: .8rem; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>dscode 会话导出</h1>
<p>会话 ID: ${escapeHtml(input.sessionId)}${name ? ` · 会话名: ${escapeHtml(name)}` : ''}<br>
导出时间: ${escapeHtml(new Date().toISOString())}</p>
${blocks}
</body>
</html>
`;
}
