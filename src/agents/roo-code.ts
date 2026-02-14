import path from 'node:path';
import { BaseAdapter } from './base-adapter.js';
import type { ConfigPathInfo, McpServerSpec } from '../types/index.js';
import {
  getPlatform,
  getVSCodeVariant,
  fileExists,
  resolveConfigPath,
} from '../utils/platform.js';

const EXTENSION_ID = 'rooveterinaryinc.roo-cline';
const CONFIG_FILE = 'mcp_settings.json';

function getPathBase(): string {
  const variant = getVSCodeVariant();

  if (getPlatform() === 'windows') {
    return resolveConfigPath(
      path.join('%APPDATA%', variant, 'User', 'globalStorage', EXTENSION_ID),
    );
  }

  if (getPlatform() === 'macos') {
    return resolveConfigPath(
      path.join('~/Library/Application Support', variant, 'User', 'globalStorage', EXTENSION_ID),
    );
  }

  return resolveConfigPath(path.join('~/.config', variant, 'User', 'globalStorage', EXTENSION_ID));
}

function getConfigPath(scope: 'global' | 'project'): string {
  if (scope === 'project') {
    return resolveConfigPath('.roo/mcp.json');
  }

  return path.join(getPathBase(), 'settings', CONFIG_FILE);
}

function buildServerConfig(spec: McpServerSpec): Record<string, unknown> {
  const serverConfig: Record<string, unknown> = {
    alwaysAllow: [],
    disabled: false,
  };

  if (spec.transport === 'http') {
    serverConfig.type = 'streamable-http';
  } else if (spec.transport === 'sse') {
    serverConfig.type = 'sse';
  }

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

export class RooCodeAdapter extends BaseAdapter {
  id = 'roo-code';
  displayName = 'Roo Code';
  supportedTransports = ['stdio', 'http', 'sse'] as const;
  supportedScopes = ['global', 'project'] as const;
  restartRequired = false;
  rootKey = 'mcpServers';

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    return [
      {
        scope: 'global',
        path: getConfigPath('global'),
        exists: await fileExists(getConfigPath('global')),
      },
      {
        scope: 'project',
        path: getConfigPath('project'),
        exists: await fileExists(getConfigPath('project')),
      },
    ];
  }

  async detect(): Promise<boolean> {
    try {
      const globalDetection = fileExists(getConfigPath('global'));
      const projectDetection = fileExists(getConfigPath('project'));
      const [isGlobalDetected, isProjectDetected] = await Promise.all([
        globalDetection,
        projectDetection,
      ]);

      return isGlobalDetected || isProjectDetected;
    } catch {
      return false;
    }
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    return buildServerConfig(spec);
  }
}

export default RooCodeAdapter;
