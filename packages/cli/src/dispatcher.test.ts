import { describe, expect, it } from 'vitest';
import { resolveMode } from './dispatcher.js';
import { parseArgs } from './args.js';

describe('resolveMode（todos M1-S5 验收：四分支命中正确）', () => {
  it('-p 即 print', () => {
    expect(resolveMode(parseArgs(['-p', 'hi']))).toBe('print');
  });

  it('--mode json 命中 json 分支', () => {
    expect(resolveMode(parseArgs(['--mode', 'json']))).toBe('json');
  });

  it('--mode rpc 命中 rpc 分支', () => {
    expect(resolveMode(parseArgs(['--mode', 'rpc']))).toBe('rpc');
  });

  it('默认 interactive', () => {
    expect(resolveMode(parseArgs([]))).toBe('interactive');
  });

  it('--mode print 且无 -p 也进 print', () => {
    expect(resolveMode(parseArgs(['--mode', 'print']))).toBe('print');
  });

  it('-p 配显式 --mode json 进 json（SC-6.3：-p "x" --mode json）', () => {
    expect(resolveMode(parseArgs(['-p', '审查代码', '--mode', 'json']))).toBe('json');
  });
});
