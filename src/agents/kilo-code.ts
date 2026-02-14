import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import {
  directoryExists,
  getPlatform,
  getVSCodeVariant,
  resolveConfigPath,
} from '../utils/platform.js';
import { BaseAdapter } from './base-adapter.js';

const KILO_EXTENSION_ID = 'kilocode.kilo-code';

function getKiloGlobalConfigPath(): string {
  const variant = getVSCodeVariant();
  const platform = getPlatform();

  if (platform === 'macos') {
    return resolveConfigPath(
      `~/Library/Application Support/${variant}/User/globalStorage/${KILO_EXTENSION_ID}/settings/mcp_settings.json`,
    );
  }

  if (platform === 'windows') {
    return resolveConfigPath(
      `%APPDATA%/${variant}/User/globalStorage/${KILO_EXTENSION_ID}/settings/mcp_settings.json`,
    );
  }

  return resolveConfigPath(
    `~/.config/${variant}/User/globalStorage/${KILO_EXTENSION_ID}/settings/mcp_settings.json`,
  );
}

async function isKiloExtensionInstalled(): Promise<boolean> {
  const extensionDirs = [
    resolveConfigPath('~/.vscode/extensions'),
    resolveConfigPath('~/.vscode-insiders/extensions'),
    resolveConfigPath('~/.vscodium/extensions'),
  ];

  for (const extensionDir of extensionDirs) {
    if (!(await directoryExists(extensionDir))) {
      continue;
    }

    try {
      const installed = await readdir(extensionDir);
      if (installed.some((entry) => entry.toLowerCase().includes('kilocode'))) {
        return true;
      }
    } catch {
      // Ignore and keep probing other extension locations.
    }
  }

  return false;
}

export class KiloCodeAdapter extends BaseAdapter {
  id = 'kilo-code';
  displayName = 'Kilo Code';
  supportedTransports: TransportType[] = ['stdio', 'http'];
  supportedScopes: ConfigScope[] = ['global', 'project'];
  restartRequired = false;

  getConfigPaths(): ConfigPathInfo[] {
    const globalPath = getKiloGlobalConfigPath();
    const projectPath = resolveConfigPath('.kilocode/mcp.json');

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
    const globalConfigPath = getKiloGlobalConfigPath();
    const globalStorageDir = path.dirname(path.dirname(globalConfigPath));
    const [hasExtension, hasConfigDir] = await Promise.all([
      isKiloExtensionInstalled(),
      directoryExists(globalStorageDir),
    ]);

    return hasExtension || hasConfigDir;
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

export default KiloCodeAdapter;
