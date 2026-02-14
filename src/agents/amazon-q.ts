import path from 'node:path';
import { BaseAdapter } from './base-adapter.js';
import type { ConfigPathInfo, McpServerSpec } from '../types/index.js';
import { commandExists, directoryExists, fileExists, resolveConfigPath } from '../utils/platform.js';

const CONFIG_PATH = resolveConfigPath('~/.aws/amazonq/mcp.json');

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

export class AmazonQAdapter extends BaseAdapter {
  id = 'amazon-q';
  displayName = 'Amazon Q';
  supportedTransports = ['stdio', 'http'] as const;
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
      return (
        commandExists('q') ||
        (await directoryExists(path.dirname(CONFIG_PATH)))
      );
    } catch {
      return false;
    }
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    return buildServerConfig(spec);
  }
}

export default AmazonQAdapter;
