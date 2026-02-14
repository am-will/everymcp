import path from 'node:path';
import { Dirent, promises as fs } from 'node:fs';

import { BaseAdapter } from './base-adapter.js';
import { ConfigPathInfo, McpServerSpec } from '../types/index.js';
import { resolveConfigPath, getVSCodeVariant, getPlatform, fileExists } from '../utils/platform.js';

function getProjectPath(): string {
  return path.resolve(process.cwd(), '.vscode', 'settings.json');
}

function getGlobalSettingsPath(): string {
  const variant = getVSCodeVariant();
  if (getPlatform() === 'macos') {
    return resolveConfigPath(`~/Library/Application Support/${variant}/User/settings.json`);
  }

  if (getPlatform() === 'windows') {
    return resolveConfigPath(`%APPDATA%\\${variant}\\User\\settings.json`);
  }

  return resolveConfigPath(`~/.config/${variant}/User/settings.json`);
}

async function hasCodyExtension(roots: string[]): Promise<boolean> {
  for (const root of roots) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    if (entries.some((entry) => entry.isDirectory() && /cody/i.test(entry.name))) {
      return true;
    }
  }

  return false;
}

export class CodyAdapter extends BaseAdapter {
  id = 'cody';
  displayName = 'Sourcegraph Cody';
  supportedTransports = ['stdio'] as const;
  supportedScopes = ['global', 'project'] as const;
  restartRequired = false;
  rootKey = ['cody', 'mcpServers'];
  detectionCommands = ['cody'];

  async detect(): Promise<boolean> {
    const baseDetected = await super.detect();
    if (baseDetected) {
      return true;
    }

    const extensionRoots = [
      resolveConfigPath('~/.vscode/extensions'),
      resolveConfigPath('%USERPROFILE%\\.vscode\\extensions'),
    ];

    return hasCodyExtension(extensionRoots);
  }

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    const globalConfig = getGlobalSettingsPath();
    const projectConfig = getProjectPath();

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
      ...(spec.command ? { command: spec.command } : null),
      ...(spec.args ? { args: spec.args } : null),
      ...(spec.env ? { env: spec.env } : null),
      ...(spec.oauth ? { oauth: spec.oauth } : null),
      ...(spec.disabled !== undefined ? { disabled: spec.disabled } : null),
    };
  }
}

export default CodyAdapter;
