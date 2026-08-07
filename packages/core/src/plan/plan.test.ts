import { describe, expect, it } from 'vitest';
import { PlanManager, WRITE_TOOLS } from './plan.js';

describe('PlanManager（todos M5-S2，SC-4.4）', () => {
  it('enter/accept 切换只读模式', () => {
    const plan = new PlanManager();
    expect(plan.isActive).toBe(false);
    plan.enter();
    expect(plan.isActive).toBe(true);
    plan.accept();
    expect(plan.isActive).toBe(false);
  });

  it('setSteps 生成 pending 步骤，markStep 推进状态，remaining 计数', () => {
    const plan = new PlanManager();
    plan.setSteps(['读需求', '改代码', '跑测试']);
    const steps = plan.getSteps();
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ id: 'step-1', title: '读需求', status: 'pending' });
    plan.markStep('step-1', 'done');
    plan.markStep('step-2', 'failed');
    expect(plan.remaining()).toBe(1);
  });

  it('WRITE_TOOLS 含 write/edit（plan 模式需拒绝）', () => {
    expect(WRITE_TOOLS.has('write')).toBe(true);
    expect(WRITE_TOOLS.has('edit')).toBe(true);
    expect(WRITE_TOOLS.has('read')).toBe(false);
  });
});
