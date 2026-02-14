import path from 'node:path';
import { BaseAdapter } from './base-adapter.js';
import type { ConfigPathInfo, McpServerSpec } from '../types/index.js';
import {
  directoryExists,
  getPlatform,
  resolveConfigPath,
} from '../utils/platform.js';

const CONFIG_FILE = 'mcp.json';

function getGlobalConfigPath(): string {
  return resolveConfigPath(path.join('~/.junie/mcp', CONFIG_FILE));
}

function getProjectConfigPath(): string {
  return resolveConfigPath('.junie/mcp/mcp.json');
}

function getJetBrainsToolboxPaths(): string[] {
  const paths: string[] = [resolveConfigPath('~/.junie')];

  if (getPlatform() === 'linux') {
    paths.push(resolveConfigPath('~/.local/share/JetBrains/Toolbox'));
    return paths;
  }

  if (getPlatform() === 'macos') {
    paths.push(resolveConfigPath('~/Library/Application Support/JetBrains/Toolbox'));
  }

  return paths;
}

function buildServerConfig(spec: McpServerSpec): Record<string, unknown> {
  const serverConfig: Record<string, unknown> = {
    type: spec.transport === 'http' ? 'http' : 'stdio',
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

export class JetBrainsAdapter extends BaseAdapter {
  id = 'jetbrains';
  displayName = 'JetBrains';
  supportedTransports = ['stdio', 'http'] as const;
  supportedScopes = ['global', 'project'] as const;
  restartRequired = false;
  rootKey = 'servers';

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    return [
      {
        scope: 'global',
        path: getGlobalConfigPath(),
        exists: await directoryExists(getGlobalConfigPath()),
      },
      {
        scope: 'project',
        path: getProjectConfigPath(),
        exists: await directoryExists(getProjectConfigPath()),
      },
    ];
  }

  async detect(): Promise<boolean> {
    try {
      const detectionPaths = getJetBrainsToolboxPaths();
      const detectionChecks = detectionPaths.map((candidate) => directoryExists(candidate));
      const results = await Promise.all(detectionChecks);

      return results.some(Boolean);
    } catch {
      return false;
    }
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    return buildServerConfig(spec);
  }
}

export default JetBrainsAdapter;
