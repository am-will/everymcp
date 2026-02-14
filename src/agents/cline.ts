import { existsSync } from 'node:fs';
import path from 'node:path';

import { addExtraDefaults } from '../core/transformer.js';
import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import {
  directoryExists,
  getPlatform,
  getVSCodeVariant,
  resolveConfigPath,
} from '../utils/platform.js';
import { BaseAdapter } from './base-adapter.js';

const CLINE_EXTENSION_ID = 'saoudrizwan.claude-dev';

function getClineGlobalConfigPath(): string {
  const variant = getVSCodeVariant();
  const platform = getPlatform();

  if (platform === 'macos') {
    return resolveConfigPath(
      `~/Library/Application Support/${variant}/User/globalStorage/${CLINE_EXTENSION_ID}/settings/cline_mcp_settings.json`,
    );
  }

  if (platform === 'windows') {
    return resolveConfigPath(
      `%APPDATA%/${variant}/User/globalStorage/${CLINE_EXTENSION_ID}/settings/cline_mcp_settings.json`,
    );
  }

  return resolveConfigPath(
    `~/.config/${variant}/User/globalStorage/${CLINE_EXTENSION_ID}/settings/cline_mcp_settings.json`,
  );
}

export class ClineAdapter extends BaseAdapter {
  id = 'cline';
  displayName = 'Cline';
  supportedTransports: TransportType[] = ['stdio', 'http', 'sse'];
  supportedScopes: ConfigScope[] = ['global'];
  restartRequired = false;

  getConfigPaths(): ConfigPathInfo[] {
    const globalPath = getClineGlobalConfigPath();

    return [
      {
        scope: 'global',
        path: globalPath,
        exists: existsSync(globalPath),
      },
    ];
  }

  async detect(): Promise<boolean> {
    const configPath = getClineGlobalConfigPath();
    const globalStorageDir = path.dirname(path.dirname(configPath));
    return directoryExists(globalStorageDir);
  }

  transformSpec(spec: McpServerSpec): Record<string, any> {
    const transformed: Record<string, any> =
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

    if (spec.transport !== 'stdio' && spec.headers && Object.keys(spec.headers).length > 0) {
      transformed.headers = { ...spec.headers };
    }

    return addExtraDefaults(transformed, {
      alwaysAllow: [],
      disabled: spec.disabled ?? false,
    });
  }
}

export default ClineAdapter;
