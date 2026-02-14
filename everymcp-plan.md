# Plan: everymcp - Universal MCP Server Installer

**Generated**: 2026-02-13

## Overview

Build a CLI tool called `everymcp` that adds/removes/lists MCP server configurations across all coding agents on a machine simultaneously. Uses Ink (React for CLI) for a default interactive home wizard (when users run plain `everymcp`) plus agent-selection wizard flows, Commander.js for CLI parsing, a built-in `EVERYMCP` ASCII/Unicode banner, and jsonc-parser for comment-preserving config editing.

## Prerequisites

- Node.js 18+ / npm
- TypeScript 5+
- Libraries: ink@5, @inkjs/ui, react, commander, jsonc-parser, chalk, diff, fs-extra

## Fresh Start Assumption

- This plan assumes a fresh workspace rebuild.
- Do not assume any source files or folders already exist.
- Every task must create its target directories/files when missing.
- Task dependencies indicate creation order; they are the only allowed assumptions about prior artifacts.

## Architecture

```
src/
├── index.ts                    # Entry point, Commander.js setup
├── cli/
│   ├── app.tsx                 # Root Ink app component
│   ├── banner.tsx              # Built-in EVERYMCP banner renderer
│   ├── launcher.tsx            # Default home wizard (runs on plain `everymcp`)
│   ├── wizard.tsx              # Interactive agent-selection wizard
│   ├── diff-preview.tsx        # Dry-run diff display
│   └── spinner.tsx             # Progress/status display
├── agents/
│   ├── base-adapter.ts         # Abstract base adapter class
│   ├── registry.ts             # Agent registry + auto-detection
│   ├── claude-desktop.ts
│   ├── claude-code.ts
│   ├── cursor.ts
│   ├── windsurf.ts
│   ├── vscode.ts
│   ├── zed.ts
│   ├── cline.ts
│   ├── roo-code.ts
│   ├── cody.ts
│   ├── jetbrains.ts
│   ├── neovim.ts
│   ├── kilo-code.ts
│   ├── amazon-q.ts
│   └── gemini-cli.ts
├── core/
│   ├── config-manager.ts       # Read/write/merge configs (jsonc-parser, comment-preserving)
│   ├── backup-manager.ts       # Backup/restore system
│   ├── server-spec.ts          # Canonical MCP server spec type + parser
│   ├── transformer.ts          # Shared transform helpers (platform wrapping, env syntax)
│   └── diff-engine.ts          # Generate diffs for dry-run
├── types/
│   └── index.ts                # Shared TypeScript types
└── utils/
    ├── platform.ts             # OS detection, path resolution
    └── validation.ts           # Input validation helpers
```

## Design Decisions (from review)

1. **jsonc-parser instead of json5**: Use Microsoft's `jsonc-parser` (used by VS Code itself) to read AND write configs. This preserves comments and formatting in files like Zed's `settings.json` and VS Code's `settings.json`, preventing comment stripping.

2. **transformer.ts provides shared helpers, adapters own their transforms**: `transformer.ts` exports helper functions (e.g., `wrapCommandForWindows()`, `addTypeField()`, `applyEnvSyntax()`). Each adapter's `transformSpec()` calls these helpers. Adapters do NOT depend on transformer.ts at the module level -- the helpers are utility functions.

3. **Shared config file serialization**: When multiple adapters target the same file (Cody + VS Code both write `settings.json`), operations are serialized: read → modify → write for the first, then read → modify → write for the second. The config manager uses a per-file lock to prevent concurrent writes.

4. **Transport validation per agent**: Each adapter declares `supportedTransports: TransportType[]`. Claude Desktop is stdio-only. Cody is stdio-only. The `addServer` flow validates transport compatibility and warns/skips incompatible agents.

5. **Server name collision handling**: When adding a server whose name already exists, warn the user and offer: overwrite, skip, or rename (with `--force` flag to auto-overwrite in non-interactive mode).

6. **Scope validation per agent**: Each adapter declares `supportedScopes: ConfigScope[]`. Global-only agents (Claude Desktop, Windsurf, Cline, Neovim, Gemini CLI) are skipped with a message when `--project` is used.

7. **Windows `cmd /c` wrapping**: Claude Desktop adapter on Windows auto-wraps stdio commands with `cmd /c` prefix and resolves `npx` to full path `C:\Program Files\nodejs\npx.cmd`.

8. **VS Code `inputs` array preservation**: The config manager preserves all existing keys during merge, including VS Code's `inputs` array.

9. **Continue.dev excluded (v1)**: Requires YAML support and fundamentally different array-based format. Planned for v2 with `js-yaml` dependency.

## Dependency Graph

```
T1 ──────────────────────────────────────┐
T2 ──────────────────────────────────────┤
T3 ──────────────────────────────────────┤
     ┌───────────────────────────────────┤
T4 ──┤                                  │
T5 ──┤ (all depend on T1, T2, T3)       │
T6 ──┤                                  │
     └───────────────────────────────────┤
T7 ─── (depends on T4, T5, T6) ─────────┤
T8 ─── (depends on T4, T5, T6) ─────────┤
T9 ─── (depends on T7, T8) ─────────────┤
T10 ── (depends on T4, T7) ────────────┤
T11 ── (depends on T9, T10) ────────────┘
```

## Tasks

### T1: Project Scaffolding & Build Setup
- **depends_on**: []
- **location**: `package.json`, `tsconfig.json`, `.gitignore`, `src/index.ts`
- **description**: Initialize the npm project with TypeScript. Set up:
  - `package.json` with name `everymcp`, bin entry pointing to `dist/index.js`, type `module`
  - Dependencies: `ink@5`, `@inkjs/ui`, `react`, `commander`, `jsonc-parser`, `chalk`, `diff`, `fs-extra`
  - Dev dependencies: `typescript`, `@types/node`, `@types/react`, `@types/fs-extra`, `@types/diff`, `tsx`
  - `tsconfig.json` with `"jsx": "react-jsx"`, `"module": "nodenext"`, `"target": "es2022"`, `"outDir": "dist"`, `"rootDir": "src"`, `"strict": true`
  - Build script: `tsc`, dev script: `tsx src/index.ts`
  - `.gitignore` for node_modules, dist, .env
  - Create initial folder scaffold: `src/`, `src/cli/`, `src/agents/`, `src/core/`, `src/types/`, `src/utils/`
  - Stub `src/index.ts` with `#!/usr/bin/env node` shebang
  - Add `.version()` to Commander program setup
- **validation**: `npm install` succeeds, `npx tsx src/index.ts --help` runs without error, `--version` flag works
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T2: Types & Interfaces
- **depends_on**: []
- **location**: `src/types/index.ts`
- **description**: Define all shared TypeScript types:
  ```typescript
  // Transport types
  type TransportType = 'stdio' | 'http' | 'sse';

  // Canonical MCP server spec (internal representation)
  interface McpServerSpec {
    name: string;
    transport: TransportType;
    // stdio fields
    command?: string;
    args?: string[];
    // http/sse fields
    url?: string;
    headers?: Record<string, string>;
    // auth
    env?: Record<string, string>;
    oauth?: { clientId?: string; callbackPort?: number };
    // metadata
    disabled?: boolean;
  }

  // Agent adapter interface
  interface AgentAdapter {
    id: string;
    displayName: string;
    supportedTransports: TransportType[];
    supportedScopes: ConfigScope[];
    restartRequired: boolean;  // Show "restart required" message after install
    detect(): Promise<boolean>;
    getConfigPaths(): ConfigPathInfo[];
    readServers(scope: ConfigScope): Promise<Record<string, any>>;
    addServer(spec: McpServerSpec, scope: ConfigScope): Promise<ConfigChange>;
    removeServer(name: string, scope: ConfigScope): Promise<ConfigChange>;
    transformSpec(spec: McpServerSpec): Record<string, any>;
    supportsScope(scope: ConfigScope): boolean;
    supportsTransport(transport: TransportType): boolean;
  }

  type ConfigScope = 'global' | 'project';

  interface ConfigPathInfo {
    scope: ConfigScope;
    path: string;
    exists: boolean;
  }

  interface ConfigChange {
    agent: string;
    configPath: string;
    before: string;
    after: string;
    action: 'add' | 'remove';
    serverName: string;
    warning?: string;  // e.g., "Restart required", "stdio only"
  }

  interface DetectedAgent {
    adapter: AgentAdapter;
    detected: boolean;
    configPaths: ConfigPathInfo[];
  }

  interface BackupEntry {
    agent: string;
    configPath: string;
    backupPath: string;
    timestamp: string;
  }
  ```
- **validation**: File compiles with `tsc --noEmit`
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T3: Platform Utilities & Validation
- **depends_on**: []
- **location**: `src/utils/platform.ts`, `src/utils/validation.ts`
- **description**:
  **platform.ts**:
  - `getPlatform()`: Returns `'macos' | 'linux' | 'windows'`
  - `expandHome(p: string)`: Expand `~` to actual home dir
  - `resolveConfigPath(template: string)`: Resolve OS-specific config paths, handling `%APPDATA%`, `%USERPROFILE%`, `~/Library/...`, `~/.config/...`
  - `commandExists(cmd: string)`: Check if a CLI command exists (uses `which` / `where`)
  - `directoryExists(dir: string)`: Async check if directory exists
  - `fileExists(file: string)`: Async check if file exists
  - `wrapCommandForWindows(command: string, args: string[])`: On Windows, wrap stdio commands with `cmd /c` and resolve `npx` to full path. Returns `{ command, args }`.
  - `getVSCodeVariant()`: Detect if running VS Code, VS Code Insiders, or VSCodium. Returns the correct globalStorage base path (e.g., `Code`, `Code - Insiders`, `VSCodium`).

  **validation.ts**:
  - `parseServerInput(input: string)`: Parse CLI input to determine if it's a URL (http/sse), command (stdio), or registry name
  - `validateUrl(url: string)`: Basic URL validation
  - `validateEnvVars(vars: string[])`: Parse `KEY=VALUE` pairs
  - `validateHeaders(headers: string[])`: Parse header `KEY=VALUE` pairs
- **validation**: Unit tests pass for path resolution on current OS, input parsing covers URLs, commands, and edge cases
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T4: Core Config Manager (jsonc-parser, comment-preserving)
- **depends_on**: [T1, T2, T3]
- **location**: `src/core/config-manager.ts`
- **description**: Implement safe config file operations using `jsonc-parser` (Microsoft's comment-preserving JSON parser, used by VS Code itself):
  - `readConfig(path: string)`: Read and parse config file. If file doesn't exist, return empty object. Uses `jsonc-parser.parse()` with comment/trailing comma tolerance.
  - `writeConfig(path: string, data: object, originalSource?: string)`: If `originalSource` is provided, use `jsonc-parser.applyEdits()` with `jsonc-parser.modify()` to apply changes while preserving comments and formatting. Otherwise write pretty-printed JSON.
  - `setProperty(source: string, path: JSONPath, value: any)`: Use `jsonc-parser.modify()` to set a property at a JSON path, preserving surrounding comments/formatting. Returns edited string.
  - `removeProperty(source: string, path: JSONPath)`: Use `jsonc-parser.modify()` to remove a property, preserving formatting.
  - `deepMergeServer(source: string, rootKey: string, serverName: string, serverConfig: object)`: High-level function that adds a server entry under the given root key, preserving all other content.
  - **File locking**: Use a per-file mutex (simple in-process lock via Map<string, Promise>) to serialize writes to the same file. This prevents Cody + VS Code adapter from clobbering each other's changes to `settings.json`.
  - **Atomic writes**: Write to `<path>.tmp`, then `fs.rename()` to final path.
  - Handle edge cases: empty files, malformed JSON (warn and skip), read-only files (error with helpful message), nested keys like `cody.mcpServers`, creating parent directories.

  **Key advantage**: `jsonc-parser.modify()` returns text edits that can be applied to the original string, preserving all comments, formatting, and trailing commas. This is critical for Zed's `settings.json` which users actively comment.
- **validation**: Can read a JSONC file with comments, add a server entry, and verify comments are preserved in output. Round-trip test: read → add server → write → read produces expected result with comments intact.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T5: Backup Manager
- **depends_on**: [T1, T2, T3]
- **location**: `src/core/backup-manager.ts`
- **description**: Implement backup/restore system:
  - Backup directory: `~/.everymcp/backups/`
  - Structure: `~/.everymcp/backups/<agent-id>/<timestamp>-<filename>`
  - `createBackup(agentId: string, configPath: string)`: Copy config file to backup location. Return BackupEntry. If source file doesn't exist, skip silently.
  - `listBackups(agentId?: string)`: List all backups, optionally filtered by agent. Return sorted by timestamp descending.
  - `restoreBackup(backupEntry: BackupEntry)`: Copy backup file back to original config path. Creates its own backup first (so restore is reversible).
  - `getLatestBackup(agentId: string, configPath: string)`: Get most recent backup for a specific agent/config.
  - Metadata file: `~/.everymcp/backups/manifest.json` tracking all backups with timestamps, agent IDs, original paths.
- **validation**: Create backup, verify file exists at expected path. Restore backup, verify config matches original. List backups returns correct entries.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T6: Server Spec Parser & Transform Helpers
- **depends_on**: [T1, T2, T3]
- **location**: `src/core/server-spec.ts`, `src/core/transformer.ts`
- **description**:
  **server-spec.ts**: Parse user input into canonical McpServerSpec:
  - URL input → `{ transport: 'http', url: '...' }` (detect SSE vs streamable HTTP if possible, default to `http`)
  - Command input → `{ transport: 'stdio', command: '...', args: [...] }` (split command string on spaces, handle quoted args)
  - Apply CLI flag overrides: `--name`, `--env`, `--header`, `--auth-token`, `--oauth-client-id`, `--transport`

  **transformer.ts**: Shared helper functions used by individual adapters' `transformSpec()`:
  - `addTypeField(config: object, transport: TransportType)`: Add `"type": "stdio"` or `"type": "http"` field (for Claude Code, VS Code, JetBrains, Roo Code)
  - `addWindsurfFields(config: object)`: Rename `url` to `serverUrl`, add `disabled: false`, `alwaysAllow: []`
  - `addZedFields(config: object)`: Add `"source": "custom"` field
  - `addExtraDefaults(config: object, fields: Record<string, any>)`: Add agent-specific default fields like `alwaysAllow`, `disabled`, `autoApprove`
  - `wrapStdioForClaudeDesktopWindows(spec: McpServerSpec)`: On Windows, wrap command with `cmd /c` and resolve npx to full path
  - Note: env var syntax differences (`${env:VAR}` for Windsurf/Roo Code vs direct values for others) are NOT handled in v1. All adapters write literal env values. This is documented as a known limitation.
- **validation**: Transform a stdio spec and HTTP spec through each helper, verify output matches expected structure.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T7: Agent Adapters - Base Class & First 7 Agents
- **depends_on**: [T4, T5, T6]
- **location**: `src/agents/base-adapter.ts`, `src/agents/claude-desktop.ts`, `src/agents/claude-code.ts`, `src/agents/cursor.ts`, `src/agents/windsurf.ts`, `src/agents/vscode.ts`, `src/agents/zed.ts`, `src/agents/cody.ts`
- **description**:
  **base-adapter.ts**: Abstract base class implementing common logic:
  ```typescript
  abstract class BaseAdapter implements AgentAdapter {
    abstract id: string;
    abstract displayName: string;
    abstract supportedTransports: TransportType[];
    abstract supportedScopes: ConfigScope[];
    abstract restartRequired: boolean;
    abstract getConfigPaths(): ConfigPathInfo[];
    abstract transformSpec(spec: McpServerSpec): Record<string, any>;

    protected rootKey: string = 'mcpServers';

    supportsScope(scope: ConfigScope): boolean {
      return this.supportedScopes.includes(scope);
    }

    supportsTransport(transport: TransportType): boolean {
      return this.supportedTransports.includes(transport);
    }

    async detect(): Promise<boolean> {
      // Check config paths exist + commands, wrapped in try/catch
      // Never throws -- returns false on any error
    }

    async readServers(scope): Promise<Record<string, any>> {
      // Use configManager to read, return servers under rootKey
    }

    async addServer(spec, scope): Promise<ConfigChange> {
      // 1. Validate scope support
      // 2. Validate transport support (warn if incompatible)
      // 3. Get config path for scope
      // 4. Read existing config (raw source string)
      // 5. Check for name collision → set warning in ConfigChange
      // 6. Transform spec to agent format
      // 7. Use configManager.deepMergeServer() to add (preserves comments)
      // 8. Write config atomically via configManager
      // 9. Return ConfigChange with before/after
    }

    async removeServer(name, scope): Promise<ConfigChange> {
      // Similar flow, uses configManager.removeProperty()
      // If server not found: return ConfigChange with warning "Server not found"
    }
  }
  ```

  **Agent-specific adapters** (each extends BaseAdapter):

  1. **claude-desktop.ts**:
     - Config: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%\Claude\claude_desktop_config.json` (Windows), `~/.config/Claude/claude_desktop_config.json` (Linux)
     - Root key: `mcpServers`
     - **supportedTransports: ['stdio']** -- HTTP/SSE not supported in config file (remote MCPs are added via Settings > Connectors UI only). Warn user when attempting HTTP/SSE.
     - supportedScopes: ['global']
     - restartRequired: true ("Restart Claude Desktop to apply changes")
     - Detection: config directory exists OR `which claude` / Claude.app
     - No `type` field needed
     - **Windows special**: Use `wrapStdioForClaudeDesktopWindows()` from transformer helpers to add `cmd /c` wrapper and resolve npx path

  2. **claude-code.ts**:
     - Global: `~/.claude.json`, Project: `.mcp.json`
     - Root key: `mcpServers`
     - supportedTransports: ['stdio', 'http', 'sse']
     - supportedScopes: ['global', 'project']
     - restartRequired: false
     - Adds `"type": "stdio"` or `"type": "http"` field
     - Detection: `which claude` or `command -v claude`

  3. **cursor.ts**:
     - Global: `~/.cursor/mcp.json`, Project: `.cursor/mcp.json`
     - Root key: `mcpServers`
     - supportedTransports: ['stdio', 'http', 'sse']
     - supportedScopes: ['global', 'project']
     - restartRequired: false (sometimes IDE reload)
     - Detection: `~/.cursor/` exists or `which cursor`

  4. **windsurf.ts**:
     - Config: `~/.codeium/windsurf/mcp_config.json` (macOS/Linux), `%USERPROFILE%\.codeium\windsurf\mcp_config.json` (Windows)
     - Root key: `mcpServers`
     - supportedTransports: ['stdio', 'http', 'sse']
     - supportedScopes: ['global']
     - restartRequired: false
     - HTTP uses `serverUrl` instead of `url`
     - Adds `disabled: false`, `alwaysAllow: []`
     - Detection: `~/.codeium/windsurf/` exists

  5. **vscode.ts**:
     - Workspace: `.vscode/mcp.json`, User: VS Code settings.json `"mcp.servers"` key
     - Root key: `servers` (NOT mcpServers!)
     - supportedTransports: ['stdio', 'http', 'sse']
     - supportedScopes: ['global', 'project']
     - restartRequired: false
     - Adds `"type": "stdio"` or `"type": "http"`
     - Detection: `which code` or `code --version`
     - **Special**: Uses `getVSCodeVariant()` to detect Code vs Insiders vs VSCodium for correct paths
     - Preserves existing `inputs` array during merge

  6. **zed.ts**:
     - Config: `~/.config/zed/settings.json` (macOS/Linux), `%APPDATA%\Zed\settings.json` (Windows)
     - Root key: `context_servers`
     - supportedTransports: ['stdio', 'http']
     - supportedScopes: ['global', 'project']
     - restartRequired: false
     - Adds `"source": "custom"` field
     - Detection: `~/.config/zed/` exists or `which zed`
     - **Critical**: Must use jsonc-parser to preserve comments in settings.json

  7. **cody.ts**:
     - Config: VS Code `settings.json` under `cody.mcpServers`
     - Root key: nested path `["cody", "mcpServers"]` inside VS Code settings
     - **supportedTransports: ['stdio']** -- Cody is stdio-only per reference
     - supportedScopes: ['global', 'project']
     - restartRequired: false
     - Detection: Check if Cody extension is installed in VS Code extensions dir
     - **Shared file**: Uses same `settings.json` as VS Code. Config manager's per-file lock ensures serialized access.

- **validation**: Each adapter can detect (or not) on current machine. Add + remove round-trip produces clean config. Config format matches agent's expected structure. Claude Desktop rejects HTTP specs with warning. Cody rejects HTTP specs with warning.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T8: Agent Adapters - Remaining 7 Agents & Registry
- **depends_on**: [T4, T5, T6]
- **location**: `src/agents/cline.ts`, `src/agents/roo-code.ts`, `src/agents/jetbrains.ts`, `src/agents/neovim.ts`, `src/agents/kilo-code.ts`, `src/agents/amazon-q.ts`, `src/agents/gemini-cli.ts`, `src/agents/registry.ts`
- **description**:
  **Remaining agent adapters**:

  8. **cline.ts**:
     - Config paths use `getVSCodeVariant()` to resolve:
       - macOS: `~/Library/Application Support/<variant>/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
       - Linux: `~/.config/<variant>/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
       - Windows: `%APPDATA%\<variant>\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
     - Root key: `mcpServers`
     - supportedTransports: ['stdio', 'http', 'sse']
     - supportedScopes: ['global']
     - restartRequired: false
     - Extra fields: `alwaysAllow: []`, `disabled: false`
     - Detection: globalStorage directory exists

  9. **roo-code.ts**:
     - Global: similar deep path as Cline but `rooveterinaryinc.roo-cline` extension
     - Project: `.roo/mcp.json`
     - Root key: `mcpServers`
     - supportedTransports: ['stdio', 'http', 'sse']
     - supportedScopes: ['global', 'project']
     - restartRequired: false
     - Extra fields: `alwaysAllow: []`, `disabled: false`
     - Supports `"type": "streamable-http"` for HTTP transport

  10. **jetbrains.ts**:
      - Global: `~/.junie/mcp/mcp.json`, Project: `.junie/mcp/mcp.json`
      - Root key: `servers` (primary)
      - supportedTransports: ['stdio', 'http']
      - supportedScopes: ['global', 'project']
      - restartRequired: false
      - Adds `"type": "stdio"` or `"type": "http"`
      - Detection: `~/.junie/` directory. Also check `~/.local/share/JetBrains/Toolbox/` (Linux) and `~/Library/Application Support/JetBrains/Toolbox/` (macOS).

  11. **neovim.ts**:
      - Config: `~/.config/mcphub/servers.json`
      - Root key: `mcpServers`
      - supportedTransports: ['stdio']
      - supportedScopes: ['global']
      - restartRequired: false
      - Extra fields: `disabled: false`, `autoApprove: []`
      - Merge must preserve existing `disabled_tools` and `custom_instructions` fields on other server entries
      - Detection: `~/.config/mcphub/` exists or `which nvim`

  12. **kilo-code.ts**:
      - Project: `.kilocode/mcp.json`
      - Global: VS Code globalStorage path (uses `getVSCodeVariant()`)
      - Root key: `mcpServers`
      - supportedTransports: ['stdio', 'http']
      - supportedScopes: ['global', 'project']
      - restartRequired: false
      - Detection: Kilo Code extension installed in VS Code extensions dir

  13. **amazon-q.ts**:
      - Config: `~/.aws/amazonq/mcp.json`
      - Root key: `mcpServers`
      - supportedTransports: ['stdio', 'http']
      - supportedScopes: ['global']
      - restartRequired: false
      - Detection: `which q` or `~/.aws/amazonq/`

  14. **gemini-cli.ts**:
      - Config: `~/.gemini/settings.json` under `mcpServers`
      - Root key: `mcpServers`
      - supportedTransports: ['stdio', 'sse']
      - supportedScopes: ['global']
      - restartRequired: false
      - Detection: `which gemini`

  **registry.ts**: Agent registry and auto-detection:
  - Import and register all 14 adapters
  - `detectAll()`: Run all adapter `detect()` in parallel with `Promise.allSettled()` (not `Promise.all()` -- catches per-adapter failures gracefully). Return `DetectedAgent[]`. Log warnings for adapters that throw errors during detection.
  - `getAdapter(id: string)`: Get adapter by ID
  - `getAllAdapters()`: Get all registered adapters
  - `getDetectedAdapters()`: Get only detected adapters

- **validation**: Registry returns all 14 agents. detectAll() correctly identifies installed agents. A single adapter's detection failure doesn't crash the whole detection run.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T9: Ink UI Components (Banner, Launcher, Wizard, Diff Preview, Spinner)
- **depends_on**: [T7, T8]
- **location**: `src/cli/banner.tsx`, `src/cli/launcher.tsx`, `src/cli/wizard.tsx`, `src/cli/diff-preview.tsx`, `src/cli/spinner.tsx`, `src/cli/app.tsx`
- **description**:
  **banner.tsx**: built-in banner renderer (no external logo runtime dependency):
  ```tsx
  // Render a fixed multi-line block logo that clearly spells "EVERYMCP"
  // Use chalk for styling (e.g. cyanBright logo + bold white tagline)
  // Show below the logo: "Universal MCP Server Installer" tagline
  // Keep output deterministic across terminals and Node versions
  ```
  Print the banner to stdout before Ink renders.

  **launcher.tsx**: default home TUI wizard:
  ```tsx
  // Interactive menu shown when users run plain `everymcp` with no subcommand.
  // Must include choices: Add, Remove, List, Detect, Backup, Restore, Quit.
  // For Add flow, collect server spec, optional name, optional auth token, scope, and dry-run.
  // Return a normalized command payload consumed by src/index.ts.
  // Escape/Ctrl+C exits cleanly.
  ```

  **wizard.tsx**: Interactive agent selection wizard using @inkjs/ui MultiSelect:
  ```tsx
  // Props: detectedAgents: DetectedAgent[], scope: ConfigScope, transport: TransportType, onSubmit: (selected: string[]) => void
  // Use MultiSelect from @inkjs/ui
  // Each option: { label: agent.displayName, value: agent.id }
  // All detected agents pre-selected by default (defaultValue)
  // Show config path info next to each agent name
  // Dim/disable agents that don't support the current scope or transport
  //   e.g., if --project: dim Claude Desktop with "(global only)" note
  //   e.g., if HTTP: dim Claude Desktop with "(stdio only)" note
  // On submit, call onSubmit with selected agent IDs
  ```

  **diff-preview.tsx**: Dry-run diff display:
  ```tsx
  // Props: changes: ConfigChange[]
  // For each change, show:
  //   Agent name + config path
  //   Unified diff (green for additions, red for removals) using `diff` library
  //   Use Ink Box with borders for each agent's diff
  //   Show any warnings (e.g., "Restart required")
  ```

  **spinner.tsx**: Progress display during operations:
  ```tsx
  // Props: message: string, agents: { name: string, status: 'pending' | 'done' | 'error', warning?: string }[]
  // Use Spinner from @inkjs/ui for the overall operation
  // Show checkmarks for completed, X marks for failed, warning symbol for skipped
  // Show post-install messages (e.g., "Restart Claude Desktop")
  ```

  **app.tsx**: Root Ink application component:
  ```tsx
  // Orchestrates agent-level interactive flow:
  // 1. Show banner (printed before Ink render)
  // 2. Show detection results
  // 3. If interactive: render Wizard for agent selection
  // 4. If dry-run: render DiffPreview
  // 5. If executing: render Spinner with progress
  // 6. Show summary on completion with per-agent restart messages
  // Export a runWizard(...) helper so CLI can launch agent selection from add/remove flows.
  ```

- **validation**: Running plain `everymcp` launches the home TUI wizard menu. Banner prints a multi-line `EVERYMCP` block logo plus tagline before the wizard. Add/remove flows can enter interactive agent selection (`Wizard`) with spacebar toggle + Enter submit. Incompatible agents are shown dimmed. Diff preview shows colored diffs. Spinner shows progress with warnings.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T10: Diff Engine (Dry-Run Support)
- **depends_on**: [T4, T7]
- **location**: `src/core/diff-engine.ts`
- **description**: Generate diffs for dry-run preview:
  - `generateDiff(configPath: string, currentContent: string, newContent: string)`: Use the `diff` library to create unified diff string
  - `previewAdd(adapter: AgentAdapter, spec: McpServerSpec, scope: ConfigScope)`: Read current config via adapter, compute what config would look like after adding server (using adapter.transformSpec + configManager), return `ConfigChange` without writing. Includes transport/scope validation warnings.
  - `previewRemove(adapter: AgentAdapter, serverName: string, scope: ConfigScope)`: Same for removal. Returns "not found" warning if server doesn't exist.
  - `previewChanges(adapters: AgentAdapter[], spec: McpServerSpec, scope: ConfigScope, action: 'add' | 'remove')`: Batch preview across multiple adapters, return `ConfigChange[]`.
- **validation**: Generates correct unified diff for add and remove operations. Shows no diff when server already exists. Shows warning for incompatible transport/scope.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T11: Commander.js CLI Entry Point & Command Wiring
- **depends_on**: [T9, T10]
- **location**: `src/index.ts`
- **description**: Wire everything together with Commander.js:

  **Commands**:

  1. `wizard`: Open interactive home TUI wizard
     - Home menu options: Add, Remove, List, Detect, Backup, Restore, Quit
     - Collect inputs for selected flow and dispatch to existing handlers
     - Used as default command (`isDefault: true`) so plain `everymcp` enters this flow

  2. `add <server-spec>`: Add MCP server to agents
     - Parse server-spec (URL or command string)
     - Apply flag overrides (--name, --env, --header, --auth-token, --oauth-client-id, --transport)
     - If `--agents` flag: use specified agents (skip wizard)
     - If `--all` flag: use all detected agents (skip wizard)
     - Otherwise: launch Ink wizard for agent selection
     - If `--dry-run`: show diff preview and exit
     - **Name collision**: If server name exists in target config, warn. With `--force`: overwrite. Without `--force` in interactive mode: prompt. Without `--force` in non-interactive: skip with warning.
     - Otherwise: backup configs, apply changes, show results
     - Show per-agent post-install messages (e.g., "Restart Claude Desktop to apply changes")

  3. `remove <server-name>`: Remove MCP server from agents
     - Same agent selection flow (wizard or flags)
     - If `--dry-run`: show diff preview
     - Otherwise: backup configs, remove from configs, show results
     - If server not found in a particular agent: show "not found" message for that agent, continue with others

  4. `list`: List all MCP servers across all detected agents
     - Detect agents, read configs, display table of all servers per agent
     - Show server name, transport type, URL/command
     - Respects `--agents` flag for filtering

  5. `detect`: Show which agents are installed
     - Run detection, display results with config paths and supported transports/scopes

  6. `backup`: Manually backup all agent configs
     - Backup every detected agent's config file(s)

  7. `restore`: Restore configs from backup
     - List available backups
     - Interactive selection or `--latest` flag
     - Restore selected backup

  **Global flags** (on program level):
  - `--version`: Show version number
  - `--agents <list>`: Comma-separated agent IDs
  - `--all`: Target all detected agents
  - `--dry-run`: Preview changes without applying
  - `--force`: Overwrite existing server entries without prompting
  - `--name <name>`: Override server name
  - `--env <KEY=VALUE>`: Set env vars (repeatable via Commander's `.option('-e, --env <pair>', 'desc', collect, [])`)
  - `--header <KEY=VALUE>`: Set HTTP headers (repeatable)
  - `--auth-token <token>`: Set bearer token (adds Authorization header)
  - `--oauth-client-id <id>`: Set OAuth client ID
  - `--transport <type>`: Force transport type
  - `--global`: Use global config scope (default)
  - `--project`: Use project-level config scope
  - `--no-backup`: Skip config backup

  **Flow for `add` command**:
  ```
  1. Parse server-spec → McpServerSpec
  2. Detect installed agents
  3. Filter by scope/transport compatibility
  4. Select agents (wizard or flags)
  5. For each selected agent (serialized for shared-file agents):
     a. If !--no-backup: create backup
     b. Check for name collision → handle per --force flag
     c. Transform spec to agent format
     d. If --dry-run: compute diff
     e. Else: write config via configManager (atomic, comment-preserving)
  6. Display results (diffs or success messages + restart warnings)
  ```

- **validation**: Plain `everymcp` opens the home TUI wizard (default command). `wizard` command opens the same flow explicitly. `add` with `--dry-run` shows preview. `add` without `--all`/`--agents` launches interactive agent selection wizard. `--agents cursor,vscode` skips agent-selection wizard. `list` shows servers from detected agents. `list --agents cursor` filters. `detect` shows installed agents. `--version` shows version. `--force` overwrites existing entries. `--project` skips global-only agents with message.
- **status**: Not Completed
- **log**:
- **files edited/created**:

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
|------|-------|----------------|
| 1 | T1, T2, T3 | Immediately |
| 2 | T4, T5, T6 | Wave 1 complete |
| 3 | T7, T8 | T4, T5, T6 complete |
| 4 | T9, T10 | T7, T8 complete (T9); T4, T7 complete (T10) |
| 5 | T11 | T9, T10 complete |

## Testing Strategy

- **Unit tests** for each adapter's `transformSpec()` output format
- **Unit tests** for config-manager: read/write/merge/remove with comment preservation
- **Unit tests** for server-spec parser: URL, command, and flag override parsing
- **Unit tests** for platform utilities: path resolution per OS, VS Code variant detection
- **Unit tests** for transport/scope validation per adapter
- **Integration test**: Full add→list→remove cycle on a temporary config directory
- **Snapshot tests**: Diff engine output for known inputs
- **Snapshot tests**: jsonc-parser round-trip with comments preserved
- **Manual testing**: Run on actual machine to verify agent detection and config editing

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Corrupting user's agent config | Backup before every write; jsonc-parser preserves comments/formatting; atomic writes |
| Agent config format changes | Each adapter is isolated; easy to update one without affecting others |
| JSON comments stripped on write | Using jsonc-parser (NOT json5) which preserves comments via text edits |
| VS Code settings.json is huge/complex | jsonc-parser.modify() only touches specific JSON paths, preserves everything else |
| Zed settings.json has comments | jsonc-parser preserves all comments and formatting |
| Shared config file (Cody + VS Code) | Per-file mutex ensures serialized read→modify→write |
| Claude Desktop rejects HTTP MCPs | Adapter declares `supportedTransports: ['stdio']`, warns user |
| Windows path edge cases | Platform utility handles all path expansion; `cmd /c` wrapping for Claude Desktop |
| VS Code Insiders/VSCodium paths | `getVSCodeVariant()` detects the correct variant |
| Server name collision | Warn + prompt in interactive, skip in non-interactive, `--force` to overwrite |
| `--project` on global-only agents | Skip with message, don't error |
| Race condition with agent hot-reload | Atomic writes (temp file + rename) |
| Banner rendering glitches across terminals | Use deterministic built-in `EVERYMCP` block logo text and simple chalk styling (no external logo runtime dependency) |
| Agents requiring restart | Show per-agent post-install message |
| Config file doesn't exist yet | Create with minimal valid structure |
| Single adapter detection crash | `Promise.allSettled()` in registry, log warning, continue |
| Continue.dev format (YAML, array) | Excluded from v1, documented as v2 feature |

## Known Limitations (v1)

1. **Continue.dev not supported** -- requires YAML parser and fundamentally different array-based config format. Planned for v2.
2. **Env var syntax differences not normalized** -- Windsurf uses `${env:VAR}`, Roo Code uses `${env:VAR}`, others use direct values. v1 writes literal values everywhere. Users wanting env var references must edit configs manually.
3. **No `update` command** -- use `remove` + `add` to update a server. Planned for v2.
4. **`list` command does not show disabled/enabled status** -- planned for v2.
5. **Amazon Q workspace scope path unknown** -- only global scope supported in v1.
