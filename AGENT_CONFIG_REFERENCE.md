# MCP Agent Configuration Reference

## Agent Config Matrix

### 1. Claude Desktop
- **Config Path (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Config Path (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`
- **Config Path (Linux):** `~/.config/Claude/claude_desktop_config.json`
- **Root Key:** `mcpServers`
- **Scope:** Global only (no project-level)
- **Transport:** stdio only in config file. Remote MCPs added via Settings > Connectors UI (not config file)
- **Restart Required:** YES - must fully quit and restart
- **Detection:** Check if config file directory exists, or `which claude` / check for Claude.app
- **Windows Gotcha:** Requires `cmd /c` wrapper for npx; use full paths like `C:\\Program Files\\nodejs\\npx.cmd`

**Stdio Example:**
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

### 2. Claude Code (CLI)
- **Config Path (Global):** `~/.claude.json` (mcpServers stored inside)
- **Config Path (Project):** `.mcp.json` in project root
- **Root Key:** `mcpServers`
- **Scope:** User (global), Project (shared), Local (per-project in ~/.claude.json)
- **Transport:** stdio, http, sse
- **CLI Command:** `claude mcp add <name> -- <command> [args...]` or `claude mcp add --type http <name> <url>`
- **Restart Required:** No (auto-detects changes)
- **Detection:** `which claude` or `command -v claude`

**Stdio Example:**
```json
{
  "mcpServers": {
    "weather": {
      "type": "stdio",
      "command": "/path/to/weather-cli",
      "args": ["--api-key", "abc123"],
      "env": { "CACHE_DIR": "/tmp" }
    }
  }
}
```

**HTTP Example:**
```json
{
  "mcpServers": {
    "remote": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "headers": { "Authorization": "Bearer ${API_TOKEN}" }
    }
  }
}
```

**OAuth Example:**
```json
{
  "mcpServers": {
    "oauth-server": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "oauth": { "clientId": "your-client-id", "callbackPort": 8080 }
    }
  }
}
```

### 3. Cursor
- **Config Path (Global):** `~/.cursor/mcp.json`
- **Config Path (Project):** `.cursor/mcp.json`
- **Config Path (Windows):** `%USERPROFILE%\.cursor\mcp.json`
- **Root Key:** `mcpServers`
- **Scope:** Global, Project
- **Transport:** stdio, http (via url), SSE
- **Restart Required:** Sometimes (IDE reload)
- **Detection:** Check `~/.cursor/` directory exists, or `which cursor`

**Stdio Example:**
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

**HTTP Example:**
```json
{
  "mcpServers": {
    "remote": {
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer YOUR_PAT" }
    }
  }
}
```

### 4. Windsurf
- **Config Path (macOS/Linux):** `~/.codeium/windsurf/mcp_config.json`
- **Config Path (Windows):** `%USERPROFILE%\.codeium\windsurf\mcp_config.json`
- **Root Key:** `mcpServers`
- **Scope:** Global only
- **Transport:** stdio, Streamable HTTP, SSE
- **Env Var Syntax:** `${env:VARIABLE_NAME}`
- **Extra Fields:** `disabled` (boolean), `alwaysAllow` (array of tool names)
- **Detection:** Check `~/.codeium/windsurf/` directory exists

**Stdio Example:**
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<TOKEN>" },
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

**HTTP Example:**
```json
{
  "mcpServers": {
    "remote": {
      "serverUrl": "https://your-server.com/mcp",
      "headers": { "API_KEY": "Bearer ${env:AUTH_TOKEN}" }
    }
  }
}
```

### 5. VS Code (GitHub Copilot)
- **Config Path (Workspace):** `.vscode/mcp.json`
- **Config Path (User):** Via settings.json `"mcp.servers"` key
- **Root Key:** `servers` (NOT `mcpServers`!)
- **Scope:** Workspace, User
- **Transport:** stdio, http, sse
- **Special:** Has `inputs` array for secure credential prompting
- **Extra Fields:** `label`, `version`, `cwd`, `dev` (watch/debug)
- **Detection:** Check `which code` or `code --version`

**Stdio Example:**
```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "api-key",
      "description": "API Key",
      "password": true
    }
  ],
  "servers": {
    "my-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${input:api-key}" }
    }
  }
}
```

**HTTP Example:**
```json
{
  "servers": {
    "remote": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### 6. Zed
- **Config Path (macOS):** `~/.config/zed/settings.json`
- **Config Path (Linux):** `~/.config/zed/settings.json`
- **Config Path (Windows):** `%APPDATA%\Zed\settings.json`
- **Root Key:** `context_servers`
- **Scope:** Global (in settings.json), Project (in .zed/settings.json)
- **Transport:** stdio (command-based). Remote via url+headers.
- **Special:** Requires `"source": "custom"` field. Recently standardized format (PR #33539).
- **Extra Fields:** `timeout`
- **Detection:** Check `~/.config/zed/` or `which zed`

**New Format (Standardized):**
```json
{
  "context_servers": {
    "github": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

**Remote Example:**
```json
{
  "context_servers": {
    "remote": {
      "source": "custom",
      "url": "https://api.example.com/mcp",
      "headers": { "Authorization": "Bearer token" }
    }
  }
}
```

### 7. Cline (VS Code Extension)
- **Config Path (macOS):** `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Config Path (Linux):** `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Config Path (Windows):** `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
- **Root Key:** `mcpServers`
- **Scope:** Global only
- **Transport:** stdio, SSE/HTTP
- **Extra Fields:** `alwaysAllow`, `disabled`
- **Detection:** Check if globalStorage directory exists

**Example:**
```json
{
  "mcpServers": {
    "server": {
      "command": "node",
      "args": ["/path/to/server.js"],
      "env": { "API_KEY": "xxx" },
      "alwaysAllow": [],
      "disabled": false
    }
  }
}
```

### 8. Roo Code (VS Code Extension)
- **Config Path (macOS):** `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`
- **Config Path (Linux):** `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`
- **Config Path (Windows):** `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\mcp_settings.json`
- **Config Path (Project):** `.roo/mcp.json`
- **Root Key:** `mcpServers`
- **Scope:** Global, Project
- **Transport:** stdio, streamable-http, sse
- **Extra Fields:** `cwd`, `alwaysAllow`, `disabled`, `type` (for remote)
- **Env Var Syntax:** `${env:VARIABLE_NAME}`
- **Detection:** Check if globalStorage directory exists

### 9. Continue.dev
- **Config Path (Global YAML):** `~/.continue/config.yaml`
- **Config Path (Global JSON):** `~/.continue/config.json`
- **Config Path (Workspace):** `.continue/mcpServers/*.yaml` or `.continue/mcpServers/*.json`
- **Root Key:** `mcpServers` (array format with `transport` object) - DIFFERENT from others!
- **Scope:** Global, Workspace
- **Transport:** stdio, SSE, Streamable HTTP
- **Detection:** Check `~/.continue/` directory exists

**YAML Example (config.yaml):**
```yaml
mcpServers:
  - name: github
    transport:
      type: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_TOKEN: ghp_xxx
```

**JSON Example (workspace .continue/mcpServers/server.json):**
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

### 10. Sourcegraph Cody
- **Config Path:** VS Code `settings.json` under `cody.mcpServers`
- **Root Key:** `cody.mcpServers` (inside VS Code settings.json)
- **Scope:** User, Workspace
- **Transport:** stdio
- **Detection:** Check if Cody extension is installed in VS Code

**Example (in settings.json):**
```json
{
  "cody.mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

### 11. JetBrains IDEs (AI Assistant / Junie)
- **Config Path (Global):** `~/.junie/mcp/mcp.json`
- **Config Path (Windows):** `%USERPROFILE%\.junie\mcp\mcp.json`
- **Config Path (Project):** `.junie/mcp/mcp.json`
- **Root Key:** `servers` or `mcpServers` (both supported)
- **Scope:** Global, Project (configured via IDE settings Level column)
- **Transport:** stdio, http
- **Detection:** Check `~/.junie/` directory or JetBrains Toolbox

**Example:**
```json
{
  "servers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "type": "stdio",
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

### 12. Neovim (MCPHub.nvim)
- **Config Path:** `~/.config/mcphub/servers.json`
- **Root Key:** `mcpServers`
- **Scope:** Global
- **Transport:** stdio
- **Extra Fields:** `disabled`, `autoApprove`, `disabled_tools`, `custom_instructions`
- **Detection:** Check `~/.config/mcphub/` directory or `which nvim`

**Example:**
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### 13. Kilo Code (VS Code Extension)
- **Config Path (Global):** `mcp_settings.json` (VS Code globalStorage)
- **Config Path (Project):** `.kilocode/mcp.json`
- **Root Key:** `mcpServers`
- **Scope:** Global, Project
- **Transport:** stdio, HTTP stream
- **Detection:** Check if Kilo Code extension is installed

### 14. Amazon Q Developer
- **Config Path:** `~/.aws/amazonq/mcp.json`
- **Root Key:** `mcpServers`
- **Scope:** Global, Workspace
- **Transport:** stdio, http
- **Detection:** Check `which q` or `~/.aws/amazonq/`

### 15. Gemini CLI
- **Config Path:** `~/.gemini/settings.json` under `mcpServers`
- **Root Key:** `mcpServers`
- **Scope:** Global
- **Transport:** stdio, sse
- **Detection:** Check `which gemini`

---

## Key Differences Summary

| Agent | Root Key | Config Format | Env Var Syntax |
|-------|----------|---------------|----------------|
| Claude Desktop | `mcpServers` | JSON | Direct values |
| Claude Code | `mcpServers` | JSON | `${VAR}`, `${VAR:-default}` |
| Cursor | `mcpServers` | JSON | `$VAR` |
| Windsurf | `mcpServers` | JSON | `${env:VAR}` |
| VS Code | `servers` | JSON | `${input:id}` |
| Zed | `context_servers` | JSON (in settings) | Direct values |
| Cline | `mcpServers` | JSON | Direct values |
| Roo Code | `mcpServers` | JSON | `${env:VAR}` |
| Continue | `mcpServers` | YAML or JSON | `${VAR}` |
| Cody | `cody.mcpServers` | JSON (in settings) | Direct values |
| JetBrains | `servers`/`mcpServers` | JSON | Direct values |
| Neovim | `mcpServers` | JSON | Direct values |
| Kilo Code | `mcpServers` | JSON | Direct values |

## HTTP URL Field Name Differences

| Agent | HTTP URL field |
|-------|---------------|
| Most agents | `url` |
| Windsurf | `serverUrl` (also accepts `url`) |
| VS Code | `url` (in `servers`) |
| Zed | `url` (in `context_servers`) |
