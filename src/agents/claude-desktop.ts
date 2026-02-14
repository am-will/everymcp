import { BaseAdapter } from './base-adapter.js';
import { ConfigPathInfo, McpServerSpec } from '../types/index.js';
import {
  directoryExists,
  fileExists,
  getPlatform,
  resolveConfigPath,
  wrapCommandForWindows,
} from '../utils/platform.js';
import path from 'node:path';

function getConfigPath(): string {
  const platform = getPlatform();
  if (platform === 'macos') {
    return resolveConfigPath('~/Library/Application Support/Claude/claude_desktop_config.json');
  }

  if (platform === 'windows') {
    return resolveConfigPath('%APPDATA%\\Claude\\claude_desktop_config.json');
  }

  return resolveConfigPath('~/.config/Claude/claude_desktop_config.json');
}

export class ClaudeDesktopAdapter extends BaseAdapter {
  id = 'claude-desktop';
  displayName = 'Claude Desktop';
  supportedTransports = ['stdio'] as const;
  supportedScopes = ['global'] as const;
  restartRequired = true;
  rootKey = 'mcpServers';
  detectionCommands = ['claude'];

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    const configPath = getConfigPath();
    const configDirectory = path.dirname(configPath);
    const exists = (await fileExists(configPath)) || (await directoryExists(configDirectory));

    return [
      {
        scope: 'global',
        path: configPath,
        exists,
      },
    ];
  }

  transformSpec(spec: McpServerSpec): Record<string, any> {
    const server: Record<string, any> = {
      ...(spec.env ? { env: spec.env } : null),
      ...(spec.oauth ? { oauth: spec.oauth } : null),
    };

    if (spec.command) {
      const wrapped = wrapCommandForWindows(spec.command, spec.args ?? []);
      server.command = wrapped.command;
      if (wrapped.args.length > 0) {
        server.args = wrapped.args;
      }
    }

    if (spec.headers) {
      server.headers = spec.headers;
    }

    if (spec.url) {
      server.url = spec.url;
    }

    if (spec.disabled !== undefined) {
      server.disabled = spec.disabled;
    }

    return server;
  }
}

export default ClaudeDesktopAdapter;
