/**
 * 错误体验（横切项 P1）：不裸栈给用户 + 可重试提示。
 * - friendlyError：识别网络/限流错误（429/5xx/ECONNREFUSED/fetch failed 等）附"稍后重试"引导
 * - 其余错误附"DSCODE_DEBUG=1 查看详细日志"引导
 */

export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // 配置/鉴权类错误（404 模型或端点不存在 / 401 未授权 / 403 无权限）：重试无用，提示检查配置
  if (/404|401|403|not found/i.test(msg)) {
    return `${msg}（模型或网关配置问题：检查 DSCODE_MODEL 是否存在、DSCODE_BASE_URL（需以 /v1 结尾）、API key）`;
  }
  const retryable = /429|50[0-9]|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|请求失败|请求中止|网络|timeout|停滞/i.test(msg);
  return retryable
    ? `${msg}（网络或限流问题：稍后重试，或检查 DSCODE_BASE_URL / 代理）`
    : `${msg}（DSCODE_DEBUG=1 可查看详细日志）`;
}
