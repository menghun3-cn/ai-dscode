import { describe, expect, it } from 'vitest';
import { AI_PACKAGE_VERSION } from './index.js';

describe('@dscode/ai 骨架', () => {
  it('导出包标识版本', () => {
    expect(AI_PACKAGE_VERSION).toBe('0.7.0');
  });
});
