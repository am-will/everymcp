import { existsSync } from 'node:fs';

import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import { commandExists, resolveConfigPath } from '../utils/platform.js';
import { BaseAdapter } from './base-adapter.js';

export class GeminiCliAdapter extends BaseAdapter {
  id = 'gemini-cli';
  displayName = 'Gemini CLI';
  supportedTransports: TransportType[] = ['stdio', 'sse'];
  supportedScopes: ConfigScope[] = ['global'];
  restartRequired = false;

  getConfigPaths(): ConfigPathInfo[] {
    const globalPath = resolveConfigPath('~/.gemini/settings.json');

    return [
      {
        scope: 'global',
        path: globalPath,
        exists: existsSync(globalPath),
      },
    ];
  }

  async detect(): Promise<boolean> {
    return commandExists('gemini');
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

    if (spec.transport === 'sse' && spec.headers && Object.keys(spec.headers).length > 0) {
      transformed.headers = { ...spec.headers };
    }

    return transformed;
  }
}

export default GeminiCliAdapter;
