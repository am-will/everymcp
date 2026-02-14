import { BaseAdapter } from './base-adapter.js';
import { ConfigPathInfo, McpServerSpec } from '../types/index.js';
import { resolveConfigPath, fileExists } from '../utils/platform.js';

function withProjectPath(template: string): string {
  return resolveConfigPath(template);
}

function buildTransportType(transport: string): 'stdio' | 'http' | 'sse' {
  if (transport === 'stdio') {
    return 'stdio';
  }

  if (transport === 'sse') {
    return 'sse';
  }

  return 'http';
}

export class ClaudeCodeAdapter extends BaseAdapter {
  id = 'claude-code';
  displayName = 'Claude Code';
  supportedTransports = ['stdio', 'http', 'sse'] as const;
  supportedScopes = ['global', 'project'] as const;
  restartRequired = false;
  rootKey = 'mcpServers';
  detectionCommands = ['claude'];

  async getConfigPaths(): Promise<ConfigPathInfo[]> {
    const globalConfig = withProjectPath('~/.claude.json');
    const projectConfig = withProjectPath('.mcp.json');

    return [
      {
        scope: 'global',
        path: globalConfig,
        exists: await fileExists(globalConfig),
      },
      {
        scope: 'project',
        path: projectConfig,
        exists: await fileExists(projectConfig),
      },
    ];
  }

  transformSpec(spec: McpServerSpec): Record<string, any> {
    return {
      ...(spec.command ? { command: spec.command } : null),
      ...(spec.args ? { args: spec.args } : null),
      ...(spec.env ? { env: spec.env } : null),
      ...(spec.url ? { url: spec.url } : null),
      ...(spec.headers ? { headers: spec.headers } : null),
      ...(spec.oauth ? { oauth: spec.oauth } : null),
      ...(spec.disabled !== undefined ? { disabled: spec.disabled } : null),
      type: buildTransportType(spec.transport),
    };
  }
}

export default ClaudeCodeAdapter;
