# DSCODE

> DeepSeek-first, multi-provider AI coding assistant for the terminal (AI IDE CLI).
> DeepSeek 优先、兼容多模型的命令行 AI 编码助手（中文版见 [README.md](README.md)）。

**Status: v0.7 — Milestones M1~M7 all closed** (MVP / Session persistence / Multi-provider / Extension system / Permission & Plan / Compaction / MCP & RPC). SC-6.1/6.2/6.3 verified end-to-end. A pnpm monorepo of three packages (`@dscode/core` / `@dscode/ai` / `@dscode/cli`) with full design docs in `docs/`.

## Positioning

| Dimension | Choice |
|-----------|--------|
| Form | Terminal CLI (not GUI IDE), inspired by Claude Code / Codex CLI |
| Primary model | DeepSeek (V3.x / R1, incl. reasoning) |
| Compatible | OpenAI, Anthropic, local inference (OpenAI-compatible), OpenRouter |
| Differentiators | DeepSeek first-class + Chinese-first UX + open extensibility |

## Documentation

All docs are navigated from [docs/索引文档.md](docs/索引文档.md) (Chinese). Key entries: architecture, requirements, acceptance criteria (SC), 12 principle docs (agent loop / compaction / plan-and-execute / file tools / sandbox / MCP / web search / session / provider / permission / extension / TUI), and progress tracking (todos-list / todos-done).

## Installation

**Option 1: npm global (SC-6.1, after registry publish)**

```bash
npm i -g dscode
dscode --version
```

**Option 2: single binary (recommended, no Node needed)**

Download the platform binary from [GitHub Releases](https://github.com/menghun3-cn/ai-dscode/releases) (`dscode-linux-x64` / `dscode-macos` / `dscode-windows-x64.exe`) and put it on PATH:

```bash
# one-liner install (Linux / macOS)
curl -fsSL https://raw.githubusercontent.com/menghun3-cn/ai-dscode/master/scripts/install.sh | sh
```

Or build locally (requires Bun): `pnpm install && pnpm build:binary`.

**Option 3: run from source (Node 22+)**

```bash
pnpm install
pnpm -r build
node packages/cli/dist/index.js
```

## Usage

Configure the API key before first run (priority: `--api-key` > `~/.dscode/auth.json` > env):

```bash
export DSCODE_API_KEY=sk-...
dscode                        # interactive TUI
dscode -p "refactor auth"     # one-shot print mode
dscode -p "review" --mode json   # JSON event stream for CI (SC-6.3)
dscode --mode rpc             # JSON-RPC over stdio for process integration
```

Key features: slash commands (`/model` `/plan` `/compact` `/tree` `/fork` `/export` …), multi-provider hot-switch (Ctrl+P), reasoning display (`/thinking`), approval modes (`--approval read-only|ask|auto-edit|full-auto`), session persistence with resume/fork, extensions (`~/.dscode/extensions`), skills (`/skill:<name>`), MCP servers (`DSCODE_MCP_SERVERS`).

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 menghun3-cn.

## Acknowledgments

dscode's design draws on the public design docs/ideas of the following projects — all implementations are independent (no line-by-line copying; naming and code are original to this project):

- **pi** (DesignDocs / public dist) — session JSONL tree, compaction, plan-and-execute design references.
- **Claude Code / Codex CLI / Cursor / OpenCode** — common agent-loop, tool-calling, permission and approval-mode patterns.
- **MCP (Model Context Protocol)** — external tool/resource integration protocol (dscode is an independent client implementation).
