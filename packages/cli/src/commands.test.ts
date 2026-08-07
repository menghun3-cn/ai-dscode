import { describe, expect, it, vi } from 'vitest';
import {
  handleSlash,
  commandCompletions,
  resolveModelArg,
  cycleMenuIndex,
  type SlashCommandContext,
  type SlashSessionOps,
} from './commands.js';

const AVAILABLE = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];

function makeSessionOps(overrides: Partial<SlashSessionOps> = {}): SlashSessionOps {
  const sessionId = 'sess-abc123';
  return {
    id: sessionId,
    activeBranch: [
      { id: 'u1', parentId: null, type: 'user', timestamp: 1, content: '你好' },
      { id: 'a1', parentId: 'u1', type: 'assistant', timestamp: 2, content: '收到' },
    ],
    jumpTo: vi.fn((id) => id === 'u1' || id === 'a1'),
    forkFrom: vi.fn(async () => 'fork-new-123'),
    clone: vi.fn(async () => 'clone-new-123'),
    label: vi.fn(async () => {}),
    exportMarkdown: vi.fn(async () => '/tmp/dscode-session-abc123.md'),
    listSessions: vi.fn(async () => [{ id: 'sess-abc123', entries: 3, mtime: 1723000000000 }]),
    ...overrides,
  };
}

function makeCtx(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext & { model: string } {
  let model = 'deepseek-chat';
  let thinkingMode = 'stream' as 'stream' | 'fold' | 'off';
  const ctx: SlashCommandContext = {
    get model() {
      return model;
    },
    availableModels: AVAILABLE,
    setModel: vi.fn((id) => {
      model = id;
    }),
    clearMessages: vi.fn(),
    costText: () => 'cost: $0.001',
    get thinkingMode() {
      return thinkingMode;
    },
    setThinkingMode: vi.fn((mode) => {
      thinkingMode = mode;
    }),
    extensions: {
      reload: vi.fn(async () => '已热重载扩展：0 个加载'),
      list: () => '扩展已加载 0 个',
    },
    skills: {
      apply: vi.fn(async (name) => (name === 'lint' ? '已加载 skill: lint' : `未找到 skill: ${name}`)),
      list: vi.fn(async () => '可用 skills:\n  lint'),
    },
    plan: {
      enter: () => '已进入 Plan 模式',
      accept: () => '已接受计划',
      setSteps: (titles) => `计划步骤已设置（${titles.length} 步）`,
    },
    permission: {
      allow: vi.fn(async (rule) => `已允许: ${rule}`),
      deny: vi.fn(async (rule) => `已拒绝: ${rule}`),
    },
    session: makeSessionOps(),
    ...overrides,
  };
  return ctx as SlashCommandContext & { model: string };
}

describe('handleSlash（todos M1-S5 验收）', () => {
  it('非 slash 输入不处理', async () => {
    const r = await handleSlash('你好', makeCtx());
    expect(r.handled).toBe(false);
  });

  it('/exit 与 /quit 都返回退出码 0', async () => {
    expect(await handleSlash('/exit', makeCtx())).toEqual({ handled: true, exitCode: 0 });
    expect(await handleSlash('/quit', makeCtx())).toEqual({ handled: true, exitCode: 0 });
  });

  it('/help 列出命令（含 /quit 与 M2 会话命令）', async () => {
    const r = await handleSlash('/help', makeCtx());
    expect(r.handled).toBe(true);
    expect(r.output).toContain('/exit');
    expect(r.output).toContain('/quit');
    expect(r.output).toContain('/model');
    expect(r.output).toContain('/tree');
    expect(r.output).toContain('/fork');
    expect(r.output).toContain('/export');
  });

  it('/model 列出可用模型（编号 + 当前标记）', async () => {
    const r = await handleSlash('/model', makeCtx());
    expect(r.output).toContain('当前模型: deepseek-chat');
    expect(r.output).toContain('1. deepseek-v4-flash');
  });

  it('/model <id> 与 <序号> 切换模型', async () => {
    const ctx = makeCtx();
    const r1 = await handleSlash('/model deepseek-reasoner', ctx);
    expect(ctx.setModel).toHaveBeenCalledWith('deepseek-reasoner');
    expect(r1.output).toContain('deepseek-reasoner');
    const ctx2 = makeCtx();
    const r2 = await handleSlash('/model 3', ctx2);
    expect(ctx2.setModel).toHaveBeenCalledWith('deepseek-reasoner');
    expect(r2.output).toContain('deepseek-reasoner');
  });

  it('/model 无效模型提示未知模型', async () => {
    const ctx = makeCtx();
    const r = await handleSlash('/model 99', ctx);
    expect(ctx.setModel).not.toHaveBeenCalled();
    expect(r.output).toContain('未知模型');
  });

  it('/cost 输出计费文本', async () => {
    const r = await handleSlash('/cost', makeCtx({ costText: () => 'cost: $0.01' }));
    expect(r.output).toContain('cost: $0.01');
  });

  it('/thinking 切换 reasoning 展示模式（SC-3.2）', async () => {
    const ctx = makeCtx();
    const r = await handleSlash('/thinking fold', ctx);
    expect(ctx.setThinkingMode).toHaveBeenCalledWith('fold');
    expect(r.output).toContain('fold');
  });

  it('/thinking 无参显示当前模式与用法', async () => {
    const r = await handleSlash('/thinking', makeCtx());
    expect(r.output).toContain('stream');
    expect(r.output).toContain('stream|fold|off');
  });

  it('/skill:<name> 加载 skill 指令注入上下文（M4-S6 验收）', async () => {
    const ctx = makeCtx();
    const r = await handleSlash('/skill:lint', ctx);
    expect(ctx.skills.apply).toHaveBeenCalledWith('lint');
    expect(r.output).toContain('已加载 skill: lint');
  });

  it('/skill: 缺名字提示用法', async () => {
    const r = await handleSlash('/skill:', makeCtx());
    expect(r.output).toContain('用法');
  });

  it('/skill 列出可用 skills', async () => {
    const r = await handleSlash('/skill', makeCtx());
    expect(r.output).toContain('lint');
  });

  it('/plan 进入只读模式（SC-4.4）', async () => {
    const ctx = makeCtx();
    const r = await handleSlash('/plan', ctx);
    expect(r.output).toContain('Plan 模式');
  });

  it('/accept-plan 落地执行', async () => {
    const r = await handleSlash('/accept-plan', makeCtx());
    expect(r.output).toContain('已接受计划');
  });

  it('/plan-set 设置步骤清单', async () => {
    const r = await handleSlash('/plan-set 读需求,改代码', makeCtx());
    expect(r.output).toContain('2 步');
  });

  it('/allow 与 /deny 持久化规则（M5 P1）', async () => {
    const ctx = makeCtx();
    const r1 = await handleSlash('/allow bash:ls -la', ctx);
    expect(ctx.permission.allow).toHaveBeenCalledWith('bash:ls -la');
    expect(r1.output).toContain('已允许');
    const r2 = await handleSlash('/deny bash:rm -rf *', ctx);
    expect(ctx.permission.deny).toHaveBeenCalledWith('bash:rm -rf *');
    expect(r2.output).toContain('已拒绝');
  });

  it('/clear 清空会话', async () => {
    const ctx = makeCtx();
    const r = await handleSlash('/clear', ctx);
    expect(ctx.clearMessages).toHaveBeenCalled();
    expect(r.output).toContain('清空');
  });

  it('未知命令提示', async () => {
    const r = await handleSlash('/bogus', makeCtx());
    expect(r.output).toContain('未知命令');
  });
});

describe('M2 会话命令', () => {
  it('/tree 展示激活分支（编号 + 类型 + 预览）', async () => {
    const r = await handleSlash('/tree', makeCtx());
    expect(r.output).toContain('#1 [user]');
    expect(r.output).toContain('#2 [assistant]');
    expect(r.output).toContain('/tree <n> 跳到该节点');
  });

  it('/tree <n> 跳到节点并改写分支', async () => {
    const ctx = makeCtx();
    const r = await handleSlash('/tree 1', ctx);
    expect(ctx.session.jumpTo).toHaveBeenCalledWith('u1');
    expect(r.output).toContain('已跳到节点 #1');
  });

  it('/tree 无效节点提示', async () => {
    const r = await handleSlash('/tree 9', makeCtx());
    expect(r.output).toContain('无效节点');
  });

  it('/fork <n> 从历史节点生成新会话（旧文件不变）', async () => {
    const ctx = makeCtx();
    const r = await handleSlash('/fork 2', ctx);
    expect(ctx.session.forkFrom).toHaveBeenCalledWith('a1');
    expect(r.output).toContain('fork-new'); // 输出为 slice(0,8)
    expect(r.output).toContain('旧文件不变');
  });

  it('/clone 复制当前分支为新会话', async () => {
    const ctx = makeCtx();
    const r = await handleSlash('/clone', ctx);
    expect(ctx.session.clone).toHaveBeenCalled();
    expect(r.output).toContain('clone-ne'); // 输出为 slice(0,8)
  });

  it('/name <名字> 给会话命名', async () => {
    const ctx = makeCtx();
    const r = await handleSlash('/name 重构会话', ctx);
    expect(ctx.session.label).toHaveBeenCalledWith('重构会话');
    expect(r.output).toContain('重构会话');
  });

  it('/name 缺参数提示用法', async () => {
    const r = await handleSlash('/name', makeCtx());
    expect(r.output).toContain('用法');
  });

  it('/export 导出 markdown 返回路径', async () => {
    const r = await handleSlash('/export', makeCtx());
    expect(r.output).toContain('/tmp/dscode-session-abc123.md');
    expect(r.output).toContain('Markdown');
  });

  it('/export html 导出 HTML', async () => {
    const r = await handleSlash('/export html', makeCtx());
    expect(r.output).toContain('HTML');
  });

  it('/resume 列出本目录会话', async () => {
    const r = await handleSlash('/resume', makeCtx());
    expect(r.output).toContain('sess-abc'); // 输出为 slice(0,8)
    expect(r.output).toContain('dscode -c');
  });
});

describe('resolveModelArg', () => {
  it('数字按 1-based 序号解析', () => {
    expect(resolveModelArg('1', AVAILABLE)).toBe('deepseek-v4-flash');
    expect(resolveModelArg('3', AVAILABLE)).toBe('deepseek-reasoner');
  });

  it('直接 id 命中返回自身', () => {
    expect(resolveModelArg('deepseek-chat', AVAILABLE)).toBe('deepseek-chat');
  });

  it('无效序号/id 返回 undefined', () => {
    expect(resolveModelArg('0', AVAILABLE)).toBeUndefined();
    expect(resolveModelArg('99', AVAILABLE)).toBeUndefined();
    expect(resolveModelArg('gpt-4o', AVAILABLE)).toBeUndefined();
  });
});

describe('commandCompletions（输入 / 后 Tab 提示）', () => {
  it('输入 / 提示全部命令（含 M2 会话命令）', () => {
    const c = commandCompletions('/', AVAILABLE);
    expect(c).toContain('/exit');
    expect(c).toContain('/quit');
    expect(c).toContain('/model');
    expect(c).toContain('/tree');
    expect(c).toContain('/fork');
    expect(c).toContain('/export');
  });

  it('输入 /mo 提示 /model 与 /models-update', () => {
    expect(commandCompletions('/mo', AVAILABLE)).toEqual(['/model', '/models-update']);
  });

  it('输入 /model <前缀> 提示模型（前缀匹配）', () => {
    expect(commandCompletions('/model deep', AVAILABLE)).toEqual(AVAILABLE);
    expect(commandCompletions('/model deepseek-v4', AVAILABLE)).toEqual(['deepseek-v4-flash']);
    expect(commandCompletions('/model v4', AVAILABLE)).toEqual([]); // 非前缀不命中
  });

  it('普通文本无补全', () => {
    expect(commandCompletions('你好', AVAILABLE)).toEqual([]);
  });
});

describe('cycleMenuIndex（↑↓ 菜单选择，越界环绕）', () => {
  it('向下环绕', () => {
    expect(cycleMenuIndex(0, 1, 6)).toBe(1);
    expect(cycleMenuIndex(5, 1, 6)).toBe(0);
  });

  it('向上环绕', () => {
    expect(cycleMenuIndex(5, -1, 6)).toBe(4);
    expect(cycleMenuIndex(0, -1, 6)).toBe(5);
  });

  it('候选为空返回 0', () => {
    expect(cycleMenuIndex(0, 1, 0)).toBe(0);
    expect(cycleMenuIndex(3, -1, 0)).toBe(0);
  });
});
