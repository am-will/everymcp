import { BaseAdapter } from './base-adapter.js';
import { ConfigPathInfo, McpServerSpec } from '../types/index.js';
import { directoryExists, fileExists, getPlatform, resolveConfigPath } from '../utils/platform.js';

function getGlobalConfigPath(): string {
  if (getPlatform() === 'windows') {
    return resolveConfigPath('%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json');
  }

  return resolveConfigPath('~/.codeium/windsurf/mcp_config.json');
}

export class WindsurfAdapter extends BaseAdapter {
  id = 'windsurf';
  displayName = 'Windsurf';
  supportedTransports = ['stdio', 'http', 'sse'] as const;
  supportedScopes = ['global'] as const;
  restartRequired = false;
  rootKey = 'mcpServers';
  detectionCommands = ['windsurf'];

  async detect(): Promise<boolean> {
    if (await super.detect()) {
      return true;
    }

    if (getPlatform() === 'windows') {
      return directoryExists(resolveConfigPath('%USERPROFILE%\\.codeium\\windsurf'));
    }

    return directoryExists(resolveConfigPath('~/.codeium/windsurf'));
  }

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    const configPath = getGlobalConfigPath();

    return [
      {
        scope: 'global',
        path: configPath,
        exists: await fileExists(configPath),
      },
    ];
  }

  transformSpec(spec: McpServerSpec): Record<string, any> {
    if (spec.transport === 'stdio') {
      return {
        ...(spec.command ? { command: spec.command } : null),
        ...(spec.args ? { args: spec.args } : null),
        ...(spec.env ? { env: spec.env } : null),
        ...(spec.oauth ? { oauth: spec.oauth } : null),
        disabled: false,
        alwaysAllow: [],
      };
    }

    return {
      ...(spec.url ? { serverUrl: spec.url } : null),
      ...(spec.headers ? { headers: spec.headers } : null),
      ...(spec.oauth ? { oauth: spec.oauth } : null),
      disabled: false,
      alwaysAllow: [],
    };
  }
}

export default WindsurfAdapter;
