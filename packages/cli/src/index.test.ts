import { describe, expect, it } from 'vitest';
import { CLI_PACKAGE_VERSION } from './index.js';

describe('@dscode/cli 骨架', () => {
  it('导出包标识版本', () => {
    expect(CLI_PACKAGE_VERSION).toBe('0.1.0');
  });
});
