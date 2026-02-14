import { existsSync } from 'node:fs';

import { addTypeField } from '../core/transformer.js';
import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import { directoryExists, getPlatform, resolveConfigPath } from '../utils/platform.js';
import { BaseAdapter } from './base-adapter.js';

export class JetBrainsAdapter extends BaseAdapter {
  id = 'jetbrains';
  displayName = 'JetBrains IDEs';
  supportedTransports: TransportType[] = ['stdio', 'http'];
  supportedScopes: ConfigScope[] = ['global', 'project'];
  restartRequired = false;
  protected rootKey = 'servers';

  getConfigPaths(): ConfigPathInfo[] {
    const globalPath = resolveConfigPath('~/.junie/mcp/mcp.json');
    const projectPath = resolveConfigPath('.junie/mcp/mcp.json');

    return [
      {
        scope: 'global',
        path: globalPath,
        exists: existsSync(globalPath),
      },
      {
        scope: 'project',
        path: projectPath,
        exists: existsSync(projectPath),
      },
    ];
  }

  async detect(): Promise<boolean> {
    const dirsToCheck = [resolveConfigPath('~/.junie/')];
    const platform = getPlatform();

    if (platform === 'linux') {
      dirsToCheck.push(resolveConfigPath('~/.local/share/JetBrains/Toolbox/'));
    } else if (platform === 'macos') {
      dirsToCheck.push(resolveConfigPath('~/Library/Application Support/JetBrains/Toolbox/'));
    } else if (platform === 'windows') {
      dirsToCheck.push(resolveConfigPath('%LOCALAPPDATA%/JetBrains/Toolbox/'));
    }

    const checks = await Promise.all(dirsToCheck.map((dir) => directoryExists(dir)));
    return checks.some(Boolean);
  }

  transformSpec(spec: McpServerSpec): Record<string, any> {
    const transformed: Record<string, unknown> =
      spec.transport === 'stdio'
        ? {
            command: spec.command ?? '',
            args: spec.args ?? [],
          }
        : {
            url: spec.url ?? '',
          };

    if (spec.env && Object.keys(spec.env).length > 0) {
      transformed.env = { ...spec.env };
    }

    if (spec.transport === 'http' && spec.headers && Object.keys(spec.headers).length > 0) {
      transformed.headers = { ...spec.headers };
    }

    return {
      ...transformed,
      ...addTypeField({}, spec.transport),
    };
  }
}

export default JetBrainsAdapter;
