import { BaseAdapter } from './base-adapter.js';
import type { ConfigPathInfo, McpServerSpec } from '../types/index.js';
import { commandExists, fileExists, resolveConfigPath } from '../utils/platform.js';

const CONFIG_PATH = resolveConfigPath('~/.gemini/settings.json');

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

export class GeminiCliAdapter extends BaseAdapter {
  id = 'gemini-cli';
  displayName = 'Gemini CLI';
  supportedTransports = ['stdio', 'sse'] as const;
  supportedScopes = ['global'] as const;
  restartRequired = false;
  rootKey = 'mcpServers';

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    return [
      {
        scope: 'global',
        path: CONFIG_PATH,
        exists: await fileExists(CONFIG_PATH),
      },
    ];
  }

  async detect(): Promise<boolean> {
    try {
      return commandExists('gemini');
    } catch {
      return false;
    }
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    return buildServerConfig(spec);
  }
}

export default GeminiCliAdapter;
