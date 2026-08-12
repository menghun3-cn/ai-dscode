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
  /** M5-S5：审批模式（read-only/ask/auto-edit/full-auto，默认 ask） */
  approval: 'read-only' | 'ask' | 'auto-edit' | 'full-auto';
  /** -c 继续会话（M2 落地，先解析） */
  cont: boolean;
  /** -r 浏览会话（M2 落地，先解析） */
  resume: boolean;
  help: boolean;
  version: boolean;
  /** --tty-info 打印终端信息（isTTY/rows/columns）诊断 TUI 布局问题 */
  ttyInfo: boolean;
  /** 位置参数（第一个可作 prompt） */
  positionals: string[];
}

/** 版本号（与 packages/cli/package.json 同步；SC-6.2 验收用 --version） */
export const DSCCODE_VERSION = '1.0.0';

export function parseArgs(argv: string[]): CliArgs {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    options: {
      print: { type: 'string', short: 'p' },
      mode: { type: 'string', short: 'm' },
      provider: { type: 'string' },
      model: { type: 'string' },
      'api-key': { type: 'string' },
      approval: { type: 'string' },
      'auto-edit': { type: 'boolean' },
      continue: { type: 'boolean', short: 'c' },
      resume: { type: 'boolean', short: 'r' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      'tty-info': { type: 'boolean' },
    },
    allowPositionals: true,
    strict: false,
  });

  const mode = values['mode'] as CliMode | undefined;
  if (mode && !['interactive', 'print', 'json', 'rpc'].includes(mode)) {
    throw new Error(`无效 --mode: ${mode}（可选 interactive/print/json/rpc）`);
  }

  // 审批模式：--approval 显式指定 > --auto-edit 快捷 flag > 默认 ask
  const approvalRaw = values['approval'] as string | undefined;
  const approval = (approvalRaw ?? (values['auto-edit'] === true ? 'auto-edit' : undefined)) as CliArgs['approval'] | undefined;
  if (approval && !['read-only', 'ask', 'auto-edit', 'full-auto'].includes(approval)) {
    throw new Error(`无效 --approval: ${approval}（可选 read-only/ask/auto-edit/full-auto）`);
  }

  return {
    printPrompt: typeof values['print'] === 'string' ? values['print'] : undefined,
    mode,
    provider: (values['provider'] as string | undefined) ?? 'deepseek',
    // --model > DSCODE_MODEL env > 默认 deepseek-v4-flash
    model: (values['model'] as string | undefined) ?? process.env['DSCODE_MODEL'] ?? 'deepseek-v4-flash',
    apiKey: values['api-key'] as string | undefined,
    approval: approval ?? 'ask',
    cont: values['continue'] === true,
    resume: values['resume'] === true,
    help: values['help'] === true,
    version: values['version'] === true,
    ttyInfo: values['tty-info'] === true,
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
      --approval <模式>     审批模式 read-only/ask/auto-edit/full-auto（默认 ask，M5-S5）
      --auto-edit          等价 --approval auto-edit（文件编辑不弹框，bash 危险命令仍确认）
  -c, --continue           继续最近会话
  -r, --resume             浏览会话
  -v, --version            显示版本号
  -h, --help               显示帮助
      --tty-info           打印终端信息（isTTY/rows/columns）诊断 TUI 布局问题

环境变量:
  DSCODE_API_KEY            API key（默认空；兼容 DEEPSEEK_API_KEY/DSAPI_API_KEY）
  DSCODE_MODEL              默认模型（默认 deepseek-v4-flash）
  DSCODE_BASE_URL           网关地址（默认 https://api.deepseek.com；兼容 DSAPI_BASE_URL）
  DSCODE_HOME               数据目录（默认 ~/.dscode）
  DSCODE_DEBUG=1            DEBUG 日志

鉴权优先级: --api-key > ~/.dscode/auth.json > DSCODE_API_KEY
`;
