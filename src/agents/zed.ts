import { BaseAdapter } from './base-adapter.js';
import { ConfigPathInfo, McpServerSpec } from '../types/index.js';
import { directoryExists, getPlatform, resolveConfigPath, fileExists } from '../utils/platform.js';

function getGlobalPath(): string {
  if (getPlatform() === 'windows') {
    return resolveConfigPath('%APPDATA%\\Zed\\settings.json');
  }

  return resolveConfigPath('~/.config/zed/settings.json');
}

function getProjectPath(): string {
  return resolveConfigPath('.zed/settings.json');
}

export class ZedAdapter extends BaseAdapter {
  id = 'zed';
  displayName = 'Zed';
  supportedTransports = ['stdio', 'http'] as const;
  supportedScopes = ['global', 'project'] as const;
  restartRequired = false;
  rootKey = 'context_servers';
  detectionCommands = ['zed'];

  async detect(): Promise<boolean> {
    if (await super.detect()) {
      return true;
    }

    if (getPlatform() === 'windows') {
      return directoryExists(resolveConfigPath('%APPDATA%\\Zed'));
    }

    return directoryExists(resolveConfigPath('~/.config/zed'));
  }

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    const globalConfig = getGlobalPath();
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
      source: 'custom',
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

export default ZedAdapter;
