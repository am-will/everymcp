import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { BaseAdapter } from './base-adapter.js';
import type { ConfigPathInfo, McpServerSpec } from '../types/index.js';
import {
  directoryExists,
  getPlatform,
  getVSCodeVariant,
  fileExists,
  resolveConfigPath,
} from '../utils/platform.js';

const EXTENSION_ID = 'kilocode.kilo-code';
const CONFIG_FILE = 'mcp_settings.json';

function getPathBase(): string {
  const variant = getVSCodeVariant();

  if (getPlatform() === 'windows') {
    return resolveConfigPath(path.join('%APPDATA%', variant, 'User', 'globalStorage', EXTENSION_ID));
  }

  if (getPlatform() === 'macos') {
    return resolveConfigPath(
      path.join('~/Library/Application Support', variant, 'User', 'globalStorage', EXTENSION_ID),
    );
  }

  return resolveConfigPath(path.join('~/.config', variant, 'User', 'globalStorage', EXTENSION_ID));
}

function getConfigPath(scope: 'global' | 'project'): string {
  if (scope === 'project') {
    return resolveConfigPath('.kilocode/mcp.json');
  }

  return path.join(getPathBase(), 'settings', CONFIG_FILE);
}

function getExtensionRoots(): string[] {
  if (getPlatform() === 'windows') {
    return [
      resolveConfigPath('%APPDATA%\\Code\\User\\globalStorage'),
      resolveConfigPath('%APPDATA%\\Code - Insiders\\User\\globalStorage'),
      resolveConfigPath('%APPDATA%\\VSCodium\\User\\globalStorage'),
      resolveConfigPath('%APPDATA%\\Antigravity\\User\\globalStorage'),
    ];
  }

  if (getPlatform() === 'macos') {
    return [
      resolveConfigPath('~/Library/Application Support/Code/User/globalStorage'),
      resolveConfigPath('~/Library/Application Support/Code - Insiders/User/globalStorage'),
      resolveConfigPath('~/Library/Application Support/VSCodium/User/globalStorage'),
      resolveConfigPath('~/Library/Application Support/Antigravity/User/globalStorage'),
    ];
  }

  return [
    resolveConfigPath('~/.config/Code/User/globalStorage'),
    resolveConfigPath('~/.config/Code - Insiders/User/globalStorage'),
    resolveConfigPath('~/.config/VSCodium/User/globalStorage'),
    resolveConfigPath('~/.config/Antigravity/User/globalStorage'),
    resolveConfigPath('~/.vscode/extensions'),
    resolveConfigPath('~/.vscode-insiders/extensions'),
    resolveConfigPath('~/.vscode-oss/extensions'),
  ];
}

function hasInstalledExtensionDirectory(root: string): boolean {
  if (!existsSync(root)) {
    return false;
  }

  const directInstallPath = path.join(root, EXTENSION_ID);
  if (existsSync(directInstallPath)) {
    return true;
  }

  try {
    const entries = readdirSync(root, { withFileTypes: true });
    return entries.some((entry) => entry.isDirectory() && entry.name.startsWith(EXTENSION_ID));
  } catch {
    return false;
  }
}

function buildServerConfig(spec: McpServerSpec): Record<string, unknown> {
  const serverConfig: Record<string, unknown> = {};

  if (spec.command) {
    serverConfig.command = spec.command;
  }

  if (spec.args && spec.args.length > 0) {
    serverConfig.args = spec.args;
  }

  if (spec.url) {
    serverConfig.url = spec.url;
  }

  if (spec.headers) {
    serverConfig.headers = spec.headers;
  }

  if (spec.env) {
    serverConfig.env = spec.env;
  }

  if (spec.oauth) {
    serverConfig.oauth = spec.oauth;
  }

  return serverConfig;
}

export class KiloCodeAdapter extends BaseAdapter {
  id = 'kilo-code';
  displayName = 'Kilo Code';
  supportedTransports = ['stdio', 'http'] as const;
  supportedScopes = ['global', 'project'] as const;
  restartRequired = false;
  rootKey = 'mcpServers';

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    return [
      {
        scope: 'global',
        path: getConfigPath('global'),
        exists: await fileExists(getConfigPath('global')),
      },
      {
        scope: 'project',
        path: getConfigPath('project'),
        exists: await fileExists(getConfigPath('project')),
      },
    ];
  }

  async detect(): Promise<boolean> {
    try {
      const extensionRoots = getExtensionRoots();
      const installed = extensionRoots.some((root) => hasInstalledExtensionDirectory(root));
      const globalConfigRoot = path.dirname(getConfigPath('global'));
      const configured = await directoryExists(globalConfigRoot);

      return installed || configured;
    } catch {
      return false;
    }
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    return buildServerConfig(spec);
  }
}

export default KiloCodeAdapter;
