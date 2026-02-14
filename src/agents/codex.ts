import { spawn } from 'node:child_process';
import { BaseAdapter } from './base-adapter.js';
import type { ConfigChange, ConfigPathInfo, ConfigScope, McpServerSpec } from '../types/index.js';
import { commandExists, fileExists, resolveConfigPath } from '../utils/platform.js';

interface CodexListTransport {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  http_headers?: Record<string, string>;
}

interface CodexListServer {
  name?: string;
  transport?: CodexListTransport;
}

function stringifyServers(servers: Record<string, unknown>): string {
  return JSON.stringify(servers, null, 2);
}

function toCodexRecord(server: CodexListServer): Record<string, unknown> {
  const transport = server.transport ?? {};
  const type = transport.type ?? '';

  if (type === 'stdio') {
    return {
      type: 'stdio',
      ...(transport.command ? { command: transport.command } : null),
      ...(Array.isArray(transport.args) ? { args: transport.args } : null),
      ...(transport.env ? { env: transport.env } : null),
    };
  }

  if (type === 'streamable_http' || type === 'http') {
    return {
      type: 'http',
      ...(transport.url ? { url: transport.url } : null),
      ...(transport.http_headers ? { headers: transport.http_headers } : null),
    };
  }

  return {
    ...(transport.command ? { command: transport.command } : null),
    ...(Array.isArray(transport.args) ? { args: transport.args } : null),
    ...(transport.env ? { env: transport.env } : null),
    ...(transport.url ? { url: transport.url } : null),
  };
}

function runCodex(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

export class CodexAdapter extends BaseAdapter {
  id = 'codex';
  displayName = 'OpenAI Codex';
  supportedTransports = ['stdio', 'http'] as const;
  supportedScopes = ['global'] as const;
  restartRequired = false;
  rootKey = 'mcp_servers';
  detectionCommands = ['codex'];

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    const globalConfig = resolveConfigPath('~/.codex/config.toml');
    return [
      {
        scope: 'global',
        path: globalConfig,
        exists: await fileExists(globalConfig),
      },
    ];
  }

  async detect(): Promise<boolean> {
    const configPath = resolveConfigPath('~/.codex/config.toml');
    return commandExists('codex') || (await fileExists(configPath));
  }

  async readServers(_scope: ConfigScope): Promise<Record<string, unknown>> {
    if (!commandExists('codex')) {
      return {};
    }

    const result = await runCodex(['mcp', 'list', '--json']);
    if (result.code !== 0 || !result.stdout) {
      return {};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return {};
    }

    if (!Array.isArray(parsed)) {
      return {};
    }

    const record: Record<string, unknown> = {};
    for (const raw of parsed) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }

      const item = raw as CodexListServer;
      const name = typeof item.name === 'string' ? item.name : '';
      if (!name) {
        continue;
      }

      record[name] = toCodexRecord(item);
    }

    return record;
  }

  async addServer(spec: McpServerSpec, scope: ConfigScope): Promise<ConfigChange> {
    const warnings: string[] = [];
    const configPath = resolveConfigPath('~/.codex/config.toml');
    const beforeServers = await this.readServers(scope);

    if (!this.supportsScope(scope)) {
      warnings.push(`Scope '${scope}' is not supported by ${this.displayName}`);
      return {
        agent: this.id,
        configPath,
        before: stringifyServers(beforeServers),
        after: stringifyServers(beforeServers),
        action: 'add',
        serverName: spec.name,
        warning: warnings.join('; '),
      };
    }

    if (!this.supportsTransport(spec.transport)) {
      warnings.push(`Transport '${spec.transport}' is not supported by ${this.displayName}`);
      return {
        agent: this.id,
        configPath,
        before: stringifyServers(beforeServers),
        after: stringifyServers(beforeServers),
        action: 'add',
        serverName: spec.name,
        warning: warnings.join('; '),
      };
    }

    if (!commandExists('codex')) {
      warnings.push('`codex` CLI not found in PATH');
      return {
        agent: this.id,
        configPath,
        before: stringifyServers(beforeServers),
        after: stringifyServers(beforeServers),
        action: 'add',
        serverName: spec.name,
        warning: warnings.join('; '),
      };
    }

    if (Object.prototype.hasOwnProperty.call(beforeServers, spec.name)) {
      warnings.push(`Server '${spec.name}' already exists in ${this.displayName}`);
    }

    const commandArgs: string[] = ['mcp', 'add', spec.name];

    if (spec.transport === 'stdio') {
      if (!spec.command) {
        warnings.push('Missing command for stdio server');
        return {
          agent: this.id,
          configPath,
          before: stringifyServers(beforeServers),
          after: stringifyServers(beforeServers),
          action: 'add',
          serverName: spec.name,
          warning: warnings.join('; '),
        };
      }

      for (const [key, value] of Object.entries(spec.env ?? {})) {
        commandArgs.push('--env', `${key}=${value}`);
      }

      commandArgs.push('--', spec.command, ...(spec.args ?? []));
    } else {
      if (!spec.url) {
        warnings.push('Missing URL for HTTP server');
        return {
          agent: this.id,
          configPath,
          before: stringifyServers(beforeServers),
          after: stringifyServers(beforeServers),
          action: 'add',
          serverName: spec.name,
          warning: warnings.join('; '),
        };
      }

      commandArgs.push('--url', spec.url);
      if (spec.headers && Object.keys(spec.headers).length > 0) {
        warnings.push('Codex MCP CLI add does not accept custom HTTP headers directly; configure headers in ~/.codex/config.toml if needed');
      }
    }

    const result = await runCodex(commandArgs);
    if (result.code !== 0) {
      warnings.push(result.stderr || 'Failed to add server via codex CLI');
      return {
        agent: this.id,
        configPath,
        before: stringifyServers(beforeServers),
        after: stringifyServers(beforeServers),
        action: 'add',
        serverName: spec.name,
        warning: warnings.join('; '),
      };
    }

    const afterServers = await this.readServers(scope);
    return {
      agent: this.id,
      configPath,
      before: stringifyServers(beforeServers),
      after: stringifyServers(afterServers),
      action: 'add',
      serverName: spec.name,
      warning: warnings.length > 0 ? warnings.join('; ') : undefined,
    };
  }

  async removeServer(name: string, scope: ConfigScope): Promise<ConfigChange> {
    const warnings: string[] = [];
    const configPath = resolveConfigPath('~/.codex/config.toml');
    const beforeServers = await this.readServers(scope);

    if (!this.supportsScope(scope)) {
      warnings.push(`Scope '${scope}' is not supported by ${this.displayName}`);
      return {
        agent: this.id,
        configPath,
        before: stringifyServers(beforeServers),
        after: stringifyServers(beforeServers),
        action: 'remove',
        serverName: name,
        warning: warnings.join('; '),
      };
    }

    if (!commandExists('codex')) {
      warnings.push('`codex` CLI not found in PATH');
      return {
        agent: this.id,
        configPath,
        before: stringifyServers(beforeServers),
        after: stringifyServers(beforeServers),
        action: 'remove',
        serverName: name,
        warning: warnings.join('; '),
      };
    }

    if (!Object.prototype.hasOwnProperty.call(beforeServers, name)) {
      warnings.push(`Server '${name}' not found in ${this.displayName}`);
      return {
        agent: this.id,
        configPath,
        before: stringifyServers(beforeServers),
        after: stringifyServers(beforeServers),
        action: 'remove',
        serverName: name,
        warning: warnings.join('; '),
      };
    }

    const result = await runCodex(['mcp', 'remove', name]);
    if (result.code !== 0) {
      warnings.push(result.stderr || 'Failed to remove server via codex CLI');
      return {
        agent: this.id,
        configPath,
        before: stringifyServers(beforeServers),
        after: stringifyServers(beforeServers),
        action: 'remove',
        serverName: name,
        warning: warnings.join('; '),
      };
    }

    const afterServers = await this.readServers(scope);
    return {
      agent: this.id,
      configPath,
      before: stringifyServers(beforeServers),
      after: stringifyServers(afterServers),
      action: 'remove',
      serverName: name,
      warning: warnings.length > 0 ? warnings.join('; ') : undefined,
    };
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    if (spec.transport === 'stdio') {
      return {
        type: 'stdio',
        ...(spec.command ? { command: spec.command } : null),
        ...(spec.args ? { args: spec.args } : null),
        ...(spec.env ? { env: spec.env } : null),
      };
    }

    return {
      type: 'http',
      ...(spec.url ? { url: spec.url } : null),
      ...(spec.headers ? { headers: spec.headers } : null),
    };
  }
}

export default CodexAdapter;
