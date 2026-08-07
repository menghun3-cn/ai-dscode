/**
 * ExtensionAPI（架构文档 §4.2.8、todos M4-S2、SC-4.1）。
 * 扩展默认导出函数收到的 dscode 实例：
 *   on / registerTool / registerCommand / registerShortcut / registerFlag + ctx.ui
 */

import { EventBus } from './bus.js';
import type { ExtensionEventMap, ExtensionEventName, ExtensionHandler, ExtensionHandlerResult } from './events.js';
import { consoleUi, type ExtensionUi } from './ui.js';

/** 扩展注册的工具（对齐 core Tool 结构，避免与 Tool 接口强耦合） */
export interface ExtensionToolDef {
  name: string;
  description: string;
  parameters: unknown;
  execute(params: Record<string, unknown>): Promise<{ output: string; isError?: boolean }>;
}

export interface ExtensionCommandDef {
  name: string;
  handler(args: string, ctx: { ui: ExtensionUi }): Promise<string | void> | string | void;
}

export interface ExtensionShortcutDef {
  keys: string;
  handler(): Promise<void> | void;
}

export interface ExtensionFlagDef {
  name: string;
  handler(value: string | undefined): Promise<void> | void;
}

/** 扩展默认导出函数签名：export default function (dscode: ExtensionApi) {...} */
export type ExtensionFactory = (dscode: ExtensionApi) => void | Promise<void>;

export class ExtensionApi {
  private readonly bus: EventBus;
  private readonly tools = new Map<string, ExtensionToolDef>();
  private readonly commands = new Map<string, ExtensionCommandDef>();
  private readonly shortcuts = new Map<string, ExtensionShortcutDef>();
  private readonly flags = new Map<string, ExtensionFlagDef>();
  private readonly extensionId: string;

  constructor(opts: { bus: EventBus; ui?: ExtensionUi; extensionId?: string }) {
    this.bus = opts.bus;
    this.ui = opts.ui ?? consoleUi;
    this.extensionId = opts.extensionId ?? 'anonymous';
  }

  /** 事件订阅（可返回 { block: true, reason } 拦截） */
  on<K extends ExtensionEventName>(event: K, handler: ExtensionHandler<K>): () => void {
    return this.bus.on(event, handler);
  }

  /** 注册 Agent 可调用的工具（并入工具集，走统一执行链） */
  registerTool(tool: ExtensionToolDef): void {
    if (this.tools.has(tool.name)) throw new Error(`[ext:${this.extensionId}] 工具已注册: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  /** 注册 slash 命令（如 /hello） */
  registerCommand(command: ExtensionCommandDef): void {
    if (this.commands.has(command.name)) throw new Error(`[ext:${this.extensionId}] 命令已注册: ${command.name}`);
    this.commands.set(command.name, command);
  }

  /** 注册 TUI 快捷键 */
  registerShortcut(shortcut: ExtensionShortcutDef): void {
    this.shortcuts.set(shortcut.keys, shortcut);
  }

  /** 注册 CLI flag */
  registerFlag(flag: ExtensionFlagDef): void {
    this.flags.set(flag.name, flag);
  }

  /** ctx.ui：确认/输入/选择/通知 */
  ui: ExtensionUi;

  /** 扩展已注册的工具（只读视图） */
  getTools(): ExtensionToolDef[] {
    return [...this.tools.values()];
  }

  getCommands(): ExtensionCommandDef[] {
    return [...this.commands.values()];
  }

  getShortcuts(): ExtensionShortcutDef[] {
    return [...this.shortcuts.values()];
  }

  getFlags(): ExtensionFlagDef[] {
    return [...this.flags.values()];
  }
}
