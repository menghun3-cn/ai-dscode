import { describe, expect, it } from 'vitest';
import { friendlyError } from './errors.js';

describe('friendlyError（横切项 P1：错误体验）', () => {
  it('404/401/403 为配置类错误，提示检查模型/网关/key（非稍后重试）', () => {
    const t = friendlyError(new Error('provider 请求失败: 404 Not Found'));
    expect(t).toContain('DSCODE_MODEL'); // 配置指导
    expect(t).not.toContain('稍后重试'); // 404 重试无用
    expect(friendlyError('401 Unauthorized')).toContain('API key');
    expect(friendlyError('403 Forbidden')).toContain('配置');
  });

  it('网络/限流错误附"稍后重试"引导（429/断网）', () => {
    expect(friendlyError(new Error('请求失败: 429 Too Many Requests'))).toContain('稍后重试');
    expect(friendlyError(new Error('fetch failed: ECONNREFUSED'))).toContain('稍后重试');
    expect(friendlyError('provider 响应停滞（300000ms 无数据）')).toContain('稍后重试');
  });

  it('普通错误附"DSCODE_DEBUG=1"引导，不裸栈', () => {
    const err = new Error('业务错误');
    err.stack = 'Error: 业务错误\n    at foo (x.ts:1:1)'; // 模拟带堆栈
    const msg = friendlyError(err);
    expect(msg).toContain('业务错误');
    expect(msg).toContain('DSCODE_DEBUG=1');
    expect(msg).not.toContain('x.ts:1:1'); // 不泄露堆栈
  });

  it('非 Error 输入（string）也能友好处理', () => {
    expect(friendlyError('网络断了')).toContain('稍后重试');
    expect(friendlyError(42)).toContain('DSCODE_DEBUG=1');
  });
});
