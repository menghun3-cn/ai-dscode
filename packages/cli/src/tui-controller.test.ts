import { describe, expect, it } from 'vitest';
import { updateMenuForLine, menuStep, menuClose, menuPick } from './tui-controller.js';
import type { TuiModel } from './tui-render.js';

function model(): TuiModel {
  return { outputLines: [], input: '', inputCursor: 0, menu: null, status: '', busy: false };
}

/** 模拟 / 命令补全（候选：/model /cost /exit） */
const commandCompletions = (line: string): string[] => {
  const all = ['/model', '/cost', '/exit'];
  return line.startsWith('/') ? all.filter((c) => c.startsWith(line)) : [];
};

describe('updateMenuForLine（输入 / 开菜单，TuiController 交互成功标准）', () => {
  it('输入 / 打开菜单，候选为匹配命令', () => {
    const m = model();
    updateMenuForLine(m, '/', commandCompletions);
    expect(m.menu).not.toBeNull();
    expect(m.menu!.candidates).toEqual(['/model', '/cost', '/exit']);
    expect(m.menu!.index).toBe(0);
  });

  it('继续输入收窄候选', () => {
    const m = model();
    updateMenuForLine(m, '/', commandCompletions);
    updateMenuForLine(m, '/m', commandCompletions);
    expect(m.menu!.candidates).toEqual(['/model']);
  });

  it('候选消失则关闭菜单', () => {
    const m = model();
    updateMenuForLine(m, '/', commandCompletions);
    updateMenuForLine(m, '普通文本', commandCompletions); // 非 / 前缀 → 无候选
    expect(m.menu).toBeNull();
  });

  it('前缀变化保留仍在候选中的选中项', () => {
    const m = model();
    updateMenuForLine(m, '/', commandCompletions);
    m.menu!.index = 2; // 选中 /exit
    updateMenuForLine(m, '/e', commandCompletions);
    expect(m.menu!.candidates).toEqual(['/exit']);
    expect(m.menu!.index).toBe(0); // /exit 在新候选中的位置
  });
});

describe('menuStep（↑↓ 导航循环）', () => {
  it('↓ 到下一个，↑ 到上一个，循环回绕', () => {
    const m = model();
    updateMenuForLine(m, '/', commandCompletions);
    menuStep(m, 1);
    expect(m.menu!.index).toBe(1);
    menuStep(m, 1);
    expect(m.menu!.index).toBe(2);
    menuStep(m, 1);
    expect(m.menu!.index).toBe(0); // 回绕
    menuStep(m, -1);
    expect(m.menu!.index).toBe(2); // 反向回绕
  });
});

describe('menuPick / menuClose（Enter 选中 / Esc 关闭）', () => {
  it('Enter 返回选中候选', () => {
    const m = model();
    updateMenuForLine(m, '/', commandCompletions);
    menuStep(m, 1);
    expect(menuPick(m)).toBe('/cost');
  });

  it('无菜单时 Enter 返回 null', () => {
    expect(menuPick(model())).toBeNull();
  });

  it('Esc 关闭菜单', () => {
    const m = model();
    updateMenuForLine(m, '/', commandCompletions);
    menuClose(m);
    expect(m.menu).toBeNull();
  });
});
