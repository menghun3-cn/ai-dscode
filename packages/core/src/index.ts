/**
 * @dscode/core — Agent Loop / 工具 / session / 权限（架构文档 §4.2）
 *
 * M1-S3 已落地：Tool 接口 + ToolRegistry、路径安全、内置工具
 * （read/write/edit/bash/glob/grep/ls）。
 */

export * from './tool.js';
export * from './util/path.js';
export * from './tools/index.js';
export * from './tools/read.js';
export * from './tools/write.js';
export * from './tools/edit.js';
export * from './tools/bash.js';
export * from './tools/glob.js';
export * from './tools/grep.js';
export * from './tools/ls.js';
export * from './agent/events.js';
export * from './agent/prompt.js';
export * from './agent/session.js';
export * from './agent/runtime.js';
export * from './session/entries.js';
export * from './session/manager.js';
export * from './session/context.js';
export * from './extension/events.js';
export * from './extension/bus.js';
export * from './extension/ui.js';
export * from './extension/api.js';
export * from './extension/trust.js';
export * from './extension/loader.js';
export * from './skill/skill.js';

export const CORE_PACKAGE_VERSION = '0.4.0';
