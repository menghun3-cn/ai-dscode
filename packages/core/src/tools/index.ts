/**
 * 内置工具聚合：一次性注册全部内置工具（M1-S3 已落地：read/write/edit/
 * bash/glob/grep/ls）。
 */

import { ToolRegistry, type Tool } from '../tool.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool } from './bash.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { lsTool } from './ls.js';

/** 全部内置工具列表 */
export const builtinTools: Tool[] = [readTool, writeTool, editTool, bashTool, globTool, grepTool, lsTool];

/** 注册全部内置工具，返回注册表 */
export function createBuiltinRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of builtinTools) {
    registry.register(tool);
  }
  return registry;
}
