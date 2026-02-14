import path from 'node:path';

import { BaseAdapter } from './base-adapter.js';
import { ConfigPathInfo, ConfigScope, McpServerSpec } from '../types/index.js';
import { getPlatform, getVSCodeVariant, fileExists, resolveConfigPath } from '../utils/platform.js';

function getVariantGlobalSettingsPath(): string {
  const variant = getVSCodeVariant();
  if (getPlatform() === 'macos') {
    return resolveConfigPath(`~/Library/Application Support/${variant}/User/settings.json`);
  }

  if (getPlatform() === 'windows') {
    return resolveConfigPath(`%APPDATA%\\${variant}\\User\\settings.json`);
  }

  return resolveConfigPath(`~/.config/${variant}/User/settings.json`);
}

function getProjectSettingsPath(): string {
  return path.resolve(process.cwd(), '.vscode', 'mcp.json');
}

function mapTransport(transport: string): 'stdio' | 'http' {
  if (transport === 'stdio') {
    return 'stdio';
  }

  return 'http';
}

export class VSCodeAdapter extends BaseAdapter {
  id = 'vscode';
  displayName = 'Visual Studio Code';
  supportedTransports = ['stdio', 'http', 'sse'] as const;
  supportedScopes = ['global', 'project'] as const;
  restartRequired = false;
  rootKey = 'mcp.servers';
  detectionCommands = ['code', 'code-insiders', 'codium', 'antigravity'];

  protected getRootKey(scope: ConfigScope): string[] {
    return scope === 'global' ? ['mcp', 'servers'] : ['servers'];
  }

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    const globalConfig = getVariantGlobalSettingsPath();
    const projectConfig = getProjectSettingsPath();

    return [
      {
        scope: 'global',
        path: globalConfig,
        exists: await fileExists(globalConfig),
      },
      {
        scope: 'project',
        path: projectConfig,
        exists: await fileExists(projectConfig),
      },
    ];
  }

  transformSpec(spec: McpServerSpec): Record<string, any> {
    return {
      type: mapTransport(spec.transport),
      ...(spec.command ? { command: spec.command } : null),
      ...(spec.args ? { args: spec.args } : null),
      ...(spec.env ? { env: spec.env } : null),
      ...(spec.url ? { url: spec.url } : null),
      ...(spec.headers ? { headers: spec.headers } : null),
      ...(spec.oauth ? { oauth: spec.oauth } : null),
      ...(spec.disabled !== undefined ? { disabled: spec.disabled } : null),
    };
  }
}

export default VSCodeAdapter;
