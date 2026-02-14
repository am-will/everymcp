import { existsSync } from 'node:fs';

import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import { commandExists, directoryExists, resolveConfigPath } from '../utils/platform.js';
import { BaseAdapter } from './base-adapter.js';

export class AmazonQAdapter extends BaseAdapter {
  id = 'amazon-q';
  displayName = 'Amazon Q Developer';
  supportedTransports: TransportType[] = ['stdio', 'http'];
  supportedScopes: ConfigScope[] = ['global'];
  restartRequired = false;

  getConfigPaths(): ConfigPathInfo[] {
    const globalPath = resolveConfigPath('~/.aws/amazonq/mcp.json');

    return [
      {
        scope: 'global',
        path: globalPath,
        exists: existsSync(globalPath),
      },
    ];
  }

  async detect(): Promise<boolean> {
    const [hasCli, hasConfigDir] = await Promise.all([
      commandExists('q'),
      directoryExists(resolveConfigPath('~/.aws/amazonq/')),
    ]);

    return hasCli || hasConfigDir;
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

    return transformed;
  }
}

export default AmazonQAdapter;
