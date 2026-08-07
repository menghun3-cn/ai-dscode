#!/usr/bin/env node
/**
 * M1-S7 验收脚本：一键跑 SC-1.1 ~ SC-1.10（成功标准.md Milestone 1）。
 * 输出 PASS/FAIL/SKIP 表（ID | 状态 | 证据）；LLM 相关 SC 失败时
 * dump turn 轨迹（每轮 tool_call + 结果摘要 + 收敛原因）。
 *
 * 用法：
 *   node scripts/verify-m1.mjs                  # 无 key：SC-1.1 实测，其余 SKIP
 *   DSCODE_API_KEY=sk-... node scripts/verify-m1.mjs   # 全量实测
 *
 * 前置：先 `pnpm -r build`（spawn 的是 dist 产物）。
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const REPO = path.resolve(import.meta.dirname, '..');
const CLI = path.join(REPO, 'packages', 'cli', 'dist', 'index.js');

const key =
  process.env['DSCODE_API_KEY'] ??
  process.env['DEEPSEEK_API_KEY'] ??
  (() => {
    const i = process.argv.indexOf('--api-key');
    return i > -1 ? process.argv[i + 1] : undefined;
  })();

/** 模型可配置（本地网关/代理常只启用特定模型；默认 deepseek-v4-flash） */
const model = process.env['DSCODE_MODEL'] ?? 'deepseek-v4-flash';

const results = [];

function record(id, name, status, evidence = '') {
  results.push({ id, name, status, evidence });
  console.log(` ${status.padEnd(4)} ${id.padEnd(7)} ${name}${evidence ? ` — ${evidence}` : ''}`);
}

/** spawn CLI，返回 {code, stdout, stderr}；支持注入 env / stdin / cwd；自动带 --model */
function runCli(args, { env = {}, input = '', cwd = REPO, timeoutMs = 150_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, '--model', model, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.on('data', (b) => (stdout += b.toString('utf8')));
    child.stderr.on('data', (b) => (stderr += b.toString('utf8')));
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve({ code: -9, stdout, stderr, timedOut: true });
      }
    }, timeoutMs);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: false });
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

/** 通过库 API 直接驱动 AgentSession（失败轨迹 dump 与 SC-1.7 多轮计数用）；带超时防挂死 */
async function runLibrary(prompt, cwd, apiKey, timeoutMs = 120_000) {
  const [core, ai] = await Promise.all([
    import(pathToFileURL(path.join(REPO, 'packages', 'core', 'dist', 'index.js')).href),
    import(pathToFileURL(path.join(REPO, 'packages', 'ai', 'dist', 'index.js')).href),
  ]);
  const client = new ai.OpenAIClient({ baseUrl: ai.resolveBaseUrl(), apiKey, timeoutMs });
  const session = core.AgentSessionRuntime.create({ cwd, tools: core.createBuiltinRegistry(), client, model });
  const killTimer = setTimeout(() => session.abort(), timeoutMs);
  try {
    const lines = [];
    let toolCalls = 0;
    for await (const ev of session.run(prompt)) {
      if (ev.type === 'tool_call') {
        toolCalls += 1;
        lines.push(`  tool_call: ${ev.toolName} ${ev.args.slice(0, 200)}`);
      } else if (ev.type === 'tool_result') {
        lines.push(`  tool_result: ${ev.toolName} ${ev.isError ? 'ERROR' : 'ok'} ${ev.output.slice(0, 200)}`);
      } else if (ev.type === 'agent_settled') {
        lines.push(`  收敛: ${ev.reason}`);
      }
    }
    return { lines, toolCalls };
  } finally {
    clearTimeout(killTimer);
    session.dispose();
  }
}

async function makeSandbox() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dscode-verify-'));
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

/** SC-1.1：无配置提示输入；输入后 auth.json 存在且 0600 */
async function sc11() {
  const sb = await makeSandbox();
  try {
    // 1a. 无任何配置 → 提示输入 key（stdin 空 → 退出）
    const r1 = await runCli([], { env: { DSCODE_HOME: sb.dir, DSCODE_API_KEY: '', DEEPSEEK_API_KEY: '', DSAPI_API_KEY: '' } });
    if (r1.code !== 1 || !r1.stdout.includes('未找到 DeepSeek API key')) {
      record('SC-1.1', '启动与鉴权', 'FAIL', `无配置应提示输入 key（code=${r1.code}）`);
      return;
    }
    // 1b. 输入 key → auth.json 存在、内容合规、0600（Windows 查 ACL 由 saveAuthKey 尽力处理）
    const r2 = await runCli([], {
      env: { DSCODE_HOME: sb.dir, DSCODE_API_KEY: '', DEEPSEEK_API_KEY: '', DSAPI_API_KEY: '' },
      input: 'sk-verify-test\n',
    });
    const authFile = path.join(sb.dir, 'auth.json');
    let modeOk = true;
    let authOk = false;
    try {
      const raw = JSON.parse(await fs.readFile(authFile, 'utf8'));
      authOk = raw['deepseek']?.type === 'api_key' && raw['deepseek']?.key === 'sk-verify-test';
      if (process.platform !== 'win32') {
        const st = await fs.stat(authFile);
        modeOk = (st.mode & 0o777) === 0o600;
      }
    } catch {
      authOk = false;
    }
    if (authOk && modeOk) {
      record('SC-1.1', '启动与鉴权', 'PASS', 'auth.json 0600 内容合规');
    } else {
      record('SC-1.1', '启动与鉴权', 'FAIL', `auth.json 缺失/权限不符（auth=${authOk}, mode=${modeOk}, code=${r2.code}）`);
    }
  } finally {
    await sb.cleanup();
  }
}

/** SC-1.2：环境变量鉴权（不读 auth 文件直接成功） */
async function sc12() {
  if (!key) return record('SC-1.2', '环境变量鉴权', 'SKIP', '需要 DSCODE_API_KEY');
  const sb = await makeSandbox();
  try {
    const r = await runCli(['-p', '回复 ok'], { env: { DSCODE_API_KEY: key } });
    r.stdout.trim() && r.code === 0 ? record('SC-1.2', '环境变量鉴权', 'PASS', `exit=${r.code}`) : record('SC-1.2', '环境变量鉴权', 'FAIL', `exit=${r.code}`);
  } finally {
    await sb.cleanup();
  }
}

/** SC-1.3~1.6：四个工具 */
async function scTool(prefix, files, prompt, check, name) {
  if (!key) return record(prefix, name, 'SKIP', '需要 DSCODE_API_KEY');
  const sb = await makeSandbox();
  try {
    for (const [f, c] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(sb.dir, f)), { recursive: true });
      await fs.writeFile(path.join(sb.dir, f), c, 'utf8');
    }
    const r = await runCli(['-p', prompt], { cwd: sb.dir, env: { DSCODE_API_KEY: key } });
    const ok = await check(sb.dir, r);
    ok ? record(prefix, name, 'PASS', `exit=${r.code}`) : record(prefix, name, 'FAIL', await trajectory(prompt, sb.dir));
  } finally {
    await sb.cleanup();
  }
}

async function trajectory(prompt, cwd) {
  try {
    const { lines } = await runLibrary(prompt, cwd, key);
    return `\n  turn 轨迹:\n${lines.join('\n')}`;
  } catch {
    return '（轨迹 dump 失败）';
  }
}

/** SC-1.7：Agent Loop 多轮——跑 npm test 失败就修到通过 */
async function sc17() {
  if (!key) return record('SC-1.7', 'Agent Loop 多轮', 'SKIP', '需要 DSCODE_API_KEY');
  const sb = await makeSandbox();
  try {
    await fs.writeFile(
      path.join(sb.dir, 'package.json'),
      JSON.stringify({ name: 'sc17', scripts: { test: 'node test.js' } }),
      'utf8',
    );
    // 初始测试失败，留一个易修复的 bug：1+1 误写为 3
    await fs.writeFile(path.join(sb.dir, 'test.js'), 'const { strictEqual } = require("node:assert"); strictEqual(1 + 1, 3);\n', 'utf8');
    let lines;
    let toolCalls = 0;
    try {
      // 多轮修复测试较耗时：给足 240s（本地推理代理每轮调用慢）
      const r = await runLibrary('跑 npm test，失败就修复直到通过', sb.dir, key, 240_000);
      lines = r.lines;
      toolCalls = r.toolCalls;
    } catch (err) {
      record('SC-1.7', 'Agent Loop 多轮', 'FAIL', `runLibrary 异常: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const { execSync } = await import('node:child_process');
    let finalOk = false;
    try {
      execSync('npm test --silent', { cwd: sb.dir, stdio: 'ignore', timeout: 30_000 });
      finalOk = true;
    } catch {
      finalOk = false;
    }
    const multiTurn = toolCalls >= 2;
    finalOk && multiTurn
      ? record('SC-1.7', 'Agent Loop 多轮', 'PASS', `${toolCalls} 轮工具调用，npm test 通过`)
      : record('SC-1.7', 'Agent Loop 多轮', 'FAIL', `finalOk=${finalOk} toolCalls=${toolCalls}\n  turn 轨迹:\n${lines.join('\n')}`);
  } finally {
    await sb.cleanup();
  }
}

/** SC-1.8：print 模式 stdin 管道 */
async function sc18() {
  if (!key) return record('SC-1.8', 'print 模式管道', 'SKIP', '需要 DSCODE_API_KEY');
  const sb = await makeSandbox();
  try {
    const r = await runCli(['-p', '-'], { cwd: sb.dir, env: { DSCODE_API_KEY: key }, input: '总结这句话' });
    r.stdout.trim() ? record('SC-1.8', 'print 模式管道', 'PASS', `exit=${r.code}`) : record('SC-1.8', 'print 模式管道', 'FAIL', `exit=${r.code} stdout 空`);
  } finally {
    await sb.cleanup();
  }
}

/** SC-1.9：interactive 最小可用（自动化：起 TUI → 输入 /help → 非零退出或正常关闭） */
async function sc19() {
  if (!key) return record('SC-1.9', 'interactive 基本可用', 'SKIP', '需要 DSCODE_API_KEY');
  const sb = await makeSandbox();
  try {
    const r = await runCli([], { cwd: sb.dir, env: { DSCODE_API_KEY: key }, input: '/help\n/exit\n', timeoutMs: 20_000 });
    const helpOk = r.stdout.includes('/exit') && r.stdout.includes('/help');
    helpOk ? record('SC-1.9', 'interactive 基本可用', 'PASS', `exit=${r.code}`) : record('SC-1.9', 'interactive 基本可用', 'FAIL', `exit=${r.code}`);
  } finally {
    await sb.cleanup();
  }
}

/** SC-1.10：中文回退 */
async function sc110() {
  if (!key) return record('SC-1.10', '中文回退', 'SKIP', '需要 DSCODE_API_KEY');
  const sb = await makeSandbox();
  try {
    const r = await runCli(['-p', '用中文回答：什么是闭包'], { cwd: sb.dir, env: { DSCODE_API_KEY: key } });
    // 中文不截断/错位：输出非空且含中文字符
    const hasCjk = /[\u4e00-\u9fff]/.test(r.stdout);
    hasCjk ? record('SC-1.10', '中文回退', 'PASS', '含中文输出') : record('SC-1.10', '中文回退', 'FAIL', `stdout 无中文: ${r.stdout.slice(0, 120)}`);
  } finally {
    await sb.cleanup();
  }
}

async function main() {
  // DSCODE_VERIFY_ONLY：逗号分隔的 SC 子集（如 SC-1.6,SC-1.7），便于分段跑
  const only = (process.env['DSCODE_VERIFY_ONLY'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const shouldRun = (id) => only.length === 0 || only.includes(id);
  console.log(`M1 验收（成功标准 SC-1.1 ~ SC-1.10）${key ? ' — 全量实测' : ' — 无 key，LLM 相关项 SKIP'}${only.length ? `（仅 ${only.join(',')}）` : ''}\n`);
  const t0 = Date.now();
  const started = (id, name) => console.log(`→ 运行 ${id} ${name} ...`);
  if (shouldRun('SC-1.1')) await sc11();
  started('SC-1.2', '环境变量鉴权');
  if (shouldRun('SC-1.2')) await sc12();
  started('SC-1.3', 'read 工具');
  if (shouldRun('SC-1.3')) await scTool('SC-1.3', { 'a.txt': 'hello' }, '读取 a.txt 并复述内容', async (dir, r) => r.stdout.includes('hello'), 'read 工具');
  started('SC-1.4', 'write 工具');
  if (shouldRun('SC-1.4')) await scTool('SC-1.4', {}, '创建文件 b.txt 内容为 world', async (dir) => {
    try {
      return (await fs.readFile(path.join(dir, 'b.txt'), 'utf8')).trim() === 'world';
    } catch {
      return false;
    }
  }, 'write 工具');
  started('SC-1.5', 'edit 工具');
  if (shouldRun('SC-1.5')) await scTool('SC-1.5', { 'c.txt': 'foo bar' }, '把 c.txt 里的 foo 改成 baz', async (dir) => {
    try {
      return (await fs.readFile(path.join(dir, 'c.txt'), 'utf8')).trim() === 'baz bar';
    } catch {
      return false;
    }
  }, 'edit 工具');
  started('SC-1.6', 'bash 工具');
  if (shouldRun('SC-1.6')) await scTool('SC-1.6', {}, "运行 node -e 'console.log(1+1)' 并告诉我结果", async (_dir, r) => r.stdout.includes('2'), 'bash 工具');
  started('SC-1.7', 'Agent Loop 多轮');
  if (shouldRun('SC-1.7')) await sc17();
  started('SC-1.8', 'print 模式管道');
  if (shouldRun('SC-1.8')) await sc18();
  started('SC-1.9', 'interactive 基本可用');
  if (shouldRun('SC-1.9')) await sc19();
  started('SC-1.10', '中文回退');
  if (shouldRun('SC-1.10')) await sc110();

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\n结果: PASS ${pass} · FAIL ${fail} · SKIP ${skip}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`验收脚本异常: ${err.stack ?? err}`);
  process.exit(2);
});
