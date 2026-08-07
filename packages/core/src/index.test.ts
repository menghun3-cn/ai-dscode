import { describe, expect, it } from 'vitest';
import { CORE_PACKAGE_VERSION } from './index.js';

describe('@dscode/core 骨架', () => {
  it('导出包标识版本', () => {
    expect(CORE_PACKAGE_VERSION).toBe('0.5.0');
  });
});
