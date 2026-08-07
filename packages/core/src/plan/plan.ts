/**
 * Plan 模式（原理-plan-and-execute.md §3/§5、todos M5-S2、SC-4.4）。
 * - plan 阶段：只读——写工具（write/edit 等）被拒；只产出步骤清单 + 风险点
 * - /accept-plan 后进入 execute：写工具放行，步骤逐条标记状态
 * - plan 步骤状态机：pending → done / failed（进度可见）
 */

export type PlanStepStatus = 'pending' | 'done' | 'failed';

export interface PlanStep {
  id: string;
  title: string;
  status: PlanStepStatus;
}

/** 只读工具白名单之外、需在 plan 模式拒绝的写工具（扩展可按需扩展） */
export const WRITE_TOOLS = new Set(['write', 'edit']);

export class PlanManager {
  private active = false;
  private steps: PlanStep[] = [];

  get isActive(): boolean {
    return this.active;
  }

  /** /plan：进入只读模式 */
  enter(): void {
    this.active = true;
  }

  /** /accept-plan：接受计划，进入 execute */
  accept(): void {
    this.active = false;
  }

  /** 设置计划步骤（由 LLM 产出或 /plan 粘贴） */
  setSteps(titles: string[]): void {
    this.steps = titles.map((title, i) => ({ id: `step-${i + 1}`, title, status: 'pending' }));
  }

  getSteps(): PlanStep[] {
    return [...this.steps];
  }

  /** 标记某步状态（execute 阶段进度可见） */
  markStep(id: string, status: PlanStepStatus): void {
    const step = this.steps.find((s) => s.id === id);
    if (step) step.status = status;
  }

  /** 剩余 pending 步数（完成验收用） */
  remaining(): number {
    return this.steps.filter((s) => s.status === 'pending').length;
  }
}
