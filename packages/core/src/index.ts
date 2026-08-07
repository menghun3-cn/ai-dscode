/**
 * @dscode/core — Agent Loop / 工具 / session / 权限（架构文档 §4.2）
 *
 * 骨架阶段：仅导出包标识与占位类型。M1-S3 落地工具层（read/write/edit/
 * bash/glob/grep），M1-S4 落地 Agent Loop 主循环。
 */

export const CORE_PACKAGE_VERSION = '0.1.0';

/** 占位类型：Tool 接口将在 M1-S3 定义（架构文档 §4.2.5） */
export type ToolPlaceholder = {
  name: string;
  description: string;
};
