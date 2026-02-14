import path from 'node:path';
import { BaseAdapter } from './base-adapter.js';
import type { ConfigPathInfo, McpServerSpec } from '../types/index.js';
import {
  directoryExists,
  getPlatform,
  getVSCodeVariant,
  fileExists,
  resolveConfigPath,
} from '../utils/platform.js';

const EXTENSION_ID = 'saoudrizwan.claude-dev';
const CONFIG_FILE = 'cline_mcp_settings.json';

function getPathBase(): string {
  const variant = getVSCodeVariant();

  if (getPlatform() === 'windows') {
    return resolveConfigPath(path.join('%APPDATA%', variant, 'User', 'globalStorage', EXTENSION_ID));
  }

  if (getPlatform() === 'macos') {
    return resolveConfigPath(
      path.join('~/Library/Application Support', variant, 'User', 'globalStorage', EXTENSION_ID),
    );
  }

  return resolveConfigPath(path.join('~/.config', variant, 'User', 'globalStorage', EXTENSION_ID));
}

function getConfigPath(): string {
  return path.join(getPathBase(), 'settings', CONFIG_FILE);
}

function buildServerConfig(spec: McpServerSpec): Record<string, unknown> {
  const serverConfig: Record<string, unknown> = {
    alwaysAllow: [],
    disabled: false,
  };

  if (spec.command) {
    serverConfig.command = spec.command;
  }

  if (spec.args && spec.args.length > 0) {
    serverConfig.args = spec.args;
  }

  if (spec.url) {
    serverConfig.url = spec.url;
  }

  if (spec.headers) {
    serverConfig.headers = spec.headers;
  }

  if (spec.env) {
    serverConfig.env = spec.env;
  }

  if (spec.oauth) {
    serverConfig.oauth = spec.oauth;
  }

  return serverConfig;
}

export class ClineAdapter extends BaseAdapter {
  id = 'cline';
  displayName = 'Cline';
  supportedTransports = ['stdio', 'http', 'sse'] as const;
  supportedScopes = ['global'] as const;
  restartRequired = false;
  rootKey = 'mcpServers';

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    const configPath = getConfigPath();
    return [
      {
        scope: 'global',
        path: configPath,
        exists: await fileExists(configPath),
      },
    ];
  }

  async detect(): Promise<boolean> {
    try {
      const globalStoragePath = path.join(getPathBase(), 'settings');
      return directoryExists(globalStoragePath);
    } catch {
      return false;
    }
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    return buildServerConfig(spec);
  }
}

export default ClineAdapter;
