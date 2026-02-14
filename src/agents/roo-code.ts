import { existsSync } from 'node:fs';
import path from 'node:path';

import { addExtraDefaults, addTypeField } from '../core/transformer.js';
import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import {
  directoryExists,
  getPlatform,
  getVSCodeVariant,
  resolveConfigPath,
} from '../utils/platform.js';
import { BaseAdapter } from './base-adapter.js';

const ROO_EXTENSION_ID = 'rooveterinaryinc.roo-cline';

function getRooGlobalConfigPath(): string {
  const variant = getVSCodeVariant();
  const platform = getPlatform();

  if (platform === 'macos') {
    return resolveConfigPath(
      `~/Library/Application Support/${variant}/User/globalStorage/${ROO_EXTENSION_ID}/settings/mcp_settings.json`,
    );
  }

  if (platform === 'windows') {
    return resolveConfigPath(
      `%APPDATA%/${variant}/User/globalStorage/${ROO_EXTENSION_ID}/settings/mcp_settings.json`,
    );
  }

  return resolveConfigPath(
    `~/.config/${variant}/User/globalStorage/${ROO_EXTENSION_ID}/settings/mcp_settings.json`,
  );
}

export class RooCodeAdapter extends BaseAdapter {
  id = 'roo-code';
  displayName = 'Roo Code';
  supportedTransports: TransportType[] = ['stdio', 'http', 'sse'];
  supportedScopes: ConfigScope[] = ['global', 'project'];
  restartRequired = false;

  getConfigPaths(): ConfigPathInfo[] {
    const globalPath = getRooGlobalConfigPath();
    const projectPath = resolveConfigPath('.roo/mcp.json');

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
    const globalConfigPath = getRooGlobalConfigPath();
    const globalStorageDir = path.dirname(path.dirname(globalConfigPath));
    const projectConfigDir = resolveConfigPath('.roo');

    const [hasGlobalStorage, hasProjectConfig] = await Promise.all([
      directoryExists(globalStorageDir),
      directoryExists(projectConfigDir),
    ]);

    return hasGlobalStorage || hasProjectConfig;
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

    if (spec.transport === 'stdio') {
      Object.assign(transformed, addTypeField({}, 'stdio'));
    } else if (spec.transport === 'http') {
      transformed.type = 'streamable-http';
    } else if (spec.transport === 'sse') {
      transformed.type = 'sse';
    }

    return addExtraDefaults(transformed, {
      alwaysAllow: [],
      disabled: spec.disabled ?? false,
    });
  }
}

export default RooCodeAdapter;
