import { BaseAdapter } from './base-adapter.js';
import { ConfigPathInfo, McpServerSpec } from '../types/index.js';
import { resolveConfigPath, fileExists, directoryExists } from '../utils/platform.js';

export class CursorAdapter extends BaseAdapter {
  id = 'cursor';
  displayName = 'Cursor';
  supportedTransports = ['stdio', 'http', 'sse'] as const;
  supportedScopes = ['global', 'project'] as const;
  restartRequired = false;
  rootKey = 'mcpServers';
  detectionCommands = ['cursor'];

  async detect(): Promise<boolean> {
    if (await super.detect()) {
      return true;
    }

    return directoryExists(resolveConfigPath('~/.cursor'));
  }

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    const globalConfig = resolveConfigPath('~/.cursor/mcp.json');
    const projectConfig = resolveConfigPath('.cursor/mcp.json');

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
      ...(spec.url ? { url: spec.url } : null),
      ...(spec.headers ? { headers: spec.headers } : null),
      ...(spec.oauth ? { oauth: spec.oauth } : null),
      ...(spec.disabled !== undefined ? { disabled: spec.disabled } : null),
    };
  }
}

export default CursorAdapter;
