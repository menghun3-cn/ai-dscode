/**
 * CLI 参数解析（需求文档 FR-1/FR-2、todos M1-S5）。
 * 用 Node 内置 util.parseArgs，零依赖。
 */

import { parseArgs as nodeParseArgs } from 'node:util';

export type CliMode = 'interactive' | 'print' | 'json' | 'rpc';

export interface CliArgs {
  /** -p/--print 后跟的 prompt 文本（进入 print 模式） */
  printPrompt?: string;
  /** --mode 显式指定模式 */
  mode?: CliMode;
  provider: string;
  model: string;
  apiKey?: string;
  /** -c 继续会话（M2 落地，先解析） */
  cont: boolean;
  /** -r 浏览会话（M2 落地，先解析） */
  resume: boolean;
  help: boolean;
  /** 位置参数（第一个可作 prompt） */
  positionals: string[];
}

export function parseArgs(argv: string[]): CliArgs {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    options: {
      print: { type: 'string', short: 'p' },
      mode: { type: 'string', short: 'm' },
      provider: { type: 'string' },
      model: { type: 'string' },
      'api-key': { type: 'string' },
      continue: { type: 'boolean', short: 'c' },
      resume: { type: 'boolean', short: 'r' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: false,
  });

  const mode = values['mode'] as CliMode | undefined;
  if (mode && !['interactive', 'print', 'json', 'rpc'].includes(mode)) {
    throw new Error(`无效 --mode: ${mode}（可选 interactive/print/json/rpc）`);
  }

  return {
    printPrompt: typeof values['print'] === 'string' ? values['print'] : undefined,
    mode,
    provider: (values['provider'] as string | undefined) ?? 'deepseek',
    // --model > DSCODE_MODEL env > 默认 deepseek-v4-flash
    model: (values['model'] as string | undefined) ?? process.env['DSCODE_MODEL'] ?? 'deepseek-v4-flash',
    apiKey: values['api-key'] as string | undefined,
    cont: values['continue'] === true,
    resume: values['resume'] === true,
    help: values['help'] === true,
    positionals,
  };
}

export const HELP_TEXT = `dscode — DeepSeek 优先的命令行 AI 编码助手

用法:
  dscode                      启动交互模式（TUI）
  dscode -p "任务描述"        一次性 print 模式
  dscode -p "任务" --mode json  结构化事件流（CI）
  dscode --mode rpc           进程集成（JSON-RPC over stdio）

参数:
  -p, --print <文本>       print 模式并直接执行该 prompt（支持 stdin 管道 -）
  -m, --mode <模式>        interactive / print / json / rpc（默认 interactive）
      --provider <id>      模型提供商（默认 deepseek）
      --model <id>         模型 id（默认 deepseek-v4-flash，可用 DSCODE_MODEL 覆盖）
      --api-key <key>      显式 API key（优先级最高）
  -c, --continue           继续最近会话（v0.2 落地）
  -r, --resume             浏览会话（v0.2 落地）
  -h, --help               显示帮助

环境变量:
  DSCODE_API_KEY            API key（默认空；兼容 DEEPSEEK_API_KEY/DSAPI_API_KEY）
  DSCODE_MODEL              默认模型（默认 deepseek-v4-flash）
  DSCODE_BASE_URL           网关地址（默认 https://api.deepseek.com；兼容 DSAPI_BASE_URL）
  DSCODE_HOME               数据目录（默认 ~/.dscode）
  DSCODE_DEBUG=1            DEBUG 日志

鉴权优先级: --api-key > ~/.dscode/auth.json > DSCODE_API_KEY
`;
