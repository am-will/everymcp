# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run build          # TypeScript compilation (tsc) → dist/
npm run dev            # Run directly via tsx (no build needed): tsx src/index.ts
npm run dev -- add "npx -y some-server" --agents claude-desktop --dry-run  # Test a command
```

No test framework is set up yet.

## Project Overview

**everymcp** is a universal MCP (Model Context Protocol) server installer CLI. It manages MCP server configurations across 14+ coding agents (Claude Desktop, VS Code, Cursor, Windsurf, Zed, Cody, Cline, Neovim, JetBrains, etc.) from a single CLI interface.

## Architecture

ES Module project (`"type": "module"`) using TypeScript (ES2022/NodeNext), React JSX (for Ink terminal UI), and Commander.js for CLI parsing.

### Agent Adapter Pattern (core abstraction)

Every agent (Claude Desktop, Cursor, VS Code, etc.) is an adapter extending `BaseAdapter` in `src/agents/base-adapter.ts`. Each adapter declares:
- `id`, `displayName`, `supportedTransports` (stdio/http/sse), `supportedScopes` (global/project)
- `getConfigPaths()` — OS-specific config file locations
- `transformSpec(spec)` — converts canonical `McpServerSpec` into agent-specific JSON format

The registry (`src/agents/registry.ts`) collects all adapters and provides `detectAll()` (parallel via `Promise.allSettled`), `getAdapter(id)`, etc.

### Config Management (`src/core/config-manager.ts`)

Uses **jsonc-parser** (not json5) to read/write config files while preserving comments and formatting. Key detail: a **per-file mutex lock** serializes concurrent writes to the same file (important because Cody and VS Code both target `settings.json`). Writes are atomic (temp file + rename).

### Source Layout

- `src/agents/` — One file per agent adapter, all extend `BaseAdapter`
- `src/core/` — Config I/O (`config-manager`), backup/restore (`backup-manager`), input parsing (`server-spec`), shared transforms (`transformer`), dry-run diffs (`diff-engine`)
- `src/cli/` — Ink/React components: `wizard.tsx` (agent selector), `diff-preview.tsx`, `spinner.tsx`, `app.tsx` (root), `banner.tsx`, `launcher.tsx`
- `src/types/` — Shared interfaces (`McpServerSpec`, `AgentAdapter`, `ConfigChange`, etc.)
- `src/utils/` — `platform.ts` (OS detection, path resolution, VS Code variant detection), `validation.ts`
- `src/index.ts` — Commander.js entry point wiring all commands and flags

### CLI Commands

`add <spec>` | `remove <name>` | `list` | `detect` | `wizard` (default/interactive) | `backup` | `restore`

Global flags: `--agents`, `--all`, `--dry-run`, `--force`, `--name`, `-e/--env`, `--header`, `--auth-token`, `--transport`, `--global/--project`, `--no-backup`

## Key Design Decisions

- **jsonc-parser for comment preservation** — critical for user-edited files like Zed's `settings.json`
- **Per-file mutex** — prevents race conditions when multiple adapters target the same config file
- **Atomic writes** — temp file + rename prevents corruption
- **`Promise.allSettled()` for detection** — one failing adapter doesn't crash the whole detection
- **Windows command wrapping** — Claude Desktop on Windows needs `cmd /c` wrapper and full npx path resolution

## Adding a New Agent Adapter

1. Create `src/agents/<agent-name>.ts` extending `BaseAdapter`
2. Implement required properties and `getConfigPaths()` / `transformSpec()`
3. Register it in `src/agents/registry.ts`
4. Add the adapter to the `allAdapters` array
