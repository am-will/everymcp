# everymcp

Universal MCP server installer CLI. Add, remove, and manage [Model Context Protocol](https://modelcontextprotocol.io/) servers across all your coding agents from a single command.

> **Note:** This project is in early development (v0.1.0) and has not been tested with every supported IDE/agent. If you run into a bug, please [create an issue](https://github.com/am-will/everymcp/issues).

## Supported Agents

| Agent | Transports | Scopes |
|-------|-----------|--------|
| Claude Desktop | stdio | global |
| Claude Code | stdio | global, project |
| OpenAI Codex | stdio | global, project |
| Cursor | stdio, http, sse | global, project |
| Windsurf | stdio | global |
| VS Code | stdio, http, sse | global, project |
| Zed | stdio | global |
| Sourcegraph Cody | stdio | global |
| Cline | stdio, http, sse | global, project |
| Roo Code | stdio, http, sse | global, project |
| JetBrains | stdio | global, project |
| Neovim | stdio | global |
| Kilo Code | stdio, http, sse | global, project |
| Amazon Q | stdio | global |
| Gemini CLI | stdio | global |

## Install

### From npm (once published)

```bash
npm install -g everymcp
```

### From source

```bash
git clone https://github.com/am-will/everymcp.git
cd everymcp
npm install
npm run build
npm link
```

`npm link` creates a symlink so the `everymcp` command is available on your PATH. You can verify with:

```bash
which everymcp
everymcp --version
```

### Run without installing

```bash
npx everymcp
```

## Usage

### Interactive wizard (default)

```bash
everymcp
```

Launches a TUI that walks you through adding a server to your detected agents.

### Add a server

```bash
# stdio server
everymcp add "npx -y @modelcontextprotocol/server-filesystem /home/user/docs"

# HTTP/SSE server
everymcp add "https://mcp.example.com/sse"

# Target specific agents
everymcp add "npx -y some-server" --agents cursor,claude-desktop

# Add to all detected agents
everymcp add "npx -y some-server" --all

# With environment variables
everymcp add "npx -y some-server" -e API_KEY=sk-123 -e DEBUG=true

# With auth token
everymcp add "https://mcp.example.com" --auth-token sk-123

# Custom server name
everymcp add "npx -y some-server" --name my-server

# Dry run (preview changes without writing)
everymcp add "npx -y some-server" --all --dry-run
```

### Remove a server

```bash
everymcp remove my-server --agents cursor,vscode
everymcp remove my-server --all
```

### List configured servers

```bash
everymcp list
everymcp list --agents claude-desktop
```

### Detect installed agents

```bash
everymcp detect
```

### Backup and restore

```bash
everymcp backup
everymcp restore
everymcp restore --latest
```

## Global Options

| Flag | Description |
|------|-------------|
| `--agents <list>` | Comma-separated agent IDs to target |
| `--all` | Target all detected agents |
| `--dry-run` | Preview changes without writing |
| `--force` | Overwrite existing entries without prompting |
| `--name <name>` | Override the inferred server name |
| `-e, --env <K=V>` | Set environment variable (repeatable) |
| `--header <K=V>` | Set HTTP header (repeatable) |
| `--auth-token <token>` | Set bearer auth token |
| `--transport <type>` | Force transport: `stdio`, `http`, or `sse` |
| `--global` | Use global config scope (default) |
| `--project` | Use project-level config scope |
| `--no-backup` | Skip automatic config backup before changes |

## How It Works

everymcp auto-detects which coding agents are installed on your system by checking for their config files. Each agent has an adapter that knows:

- Where config files live on each OS (macOS, Linux, Windows)
- How to transform a canonical MCP server spec into the agent's specific JSON format
- Which transports and scopes the agent supports

Config files are read and written using `jsonc-parser` to preserve comments and formatting. Writes are atomic (temp file + rename) with per-file mutex locking to prevent race conditions.

## Development

```bash
git clone https://github.com/am-will/everymcp.git
cd everymcp
npm install
npm run build    # TypeScript compilation
npm run dev      # Run directly via tsx
```

## License

MIT
