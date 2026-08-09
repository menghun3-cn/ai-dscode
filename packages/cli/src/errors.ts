/**
 * 错误体验（横切项 P1）：不裸栈给用户 + 可重试提示。
 * - friendlyError：识别网络/限流错误（429/5xx/ECONNREFUSED/fetch failed 等）附"稍后重试"引导
 * - 其余错误附"DSCODE_DEBUG=1 查看详细日志"引导
 */

export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const retryable = /429|50[0-9]|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|请求失败|请求中止|网络|timeout|停滞/i.test(msg);
  return retryable
    ? `${msg}（网络或限流问题：稍后重试，或检查 DSCODE_BASE_URL / 代理）`
    : `${msg}（DSCODE_DEBUG=1 可查看详细日志）`;
}
