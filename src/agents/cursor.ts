import { existsSync } from 'node:fs';
import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import { BaseAdapter } from './base-adapter.js';

export class CursorAdapter extends BaseAdapter {
  id = 'cursor';
  displayName = 'Cursor';
  supportedTransports: TransportType[] = ['stdio', 'http', 'sse'];
  supportedScopes: ConfigScope[] = ['global', 'project'];
  restartRequired = false;
  protected rootKey = 'mcpServers';

  getConfigPaths(): ConfigPathInfo[] {
    const globalPath = this.resolvePath('~/.cursor/mcp.json');
    const projectPath = '.cursor/mcp.json';

    return [
      {
        exists: existsSync(globalPath),
        path: globalPath,
        scope: 'global',
      },
      {
        exists: existsSync(projectPath),
        path: projectPath,
        scope: 'project',
      },
    ];
  }

  async detect(): Promise<boolean> {
    try {
      if (await this.directoryExists(this.resolvePath('~/.cursor'))) {
        return true;
      }
      return this.commandExists('cursor');
    } catch {
      return false;
    }
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    return this.toBaseServerConfig(spec);
  }
}
