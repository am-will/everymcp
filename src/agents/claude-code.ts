import { existsSync } from 'node:fs';
import * as transformer from '../core/transformer.js';
import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import { BaseAdapter } from './base-adapter.js';

interface TransformerLike {
  addTypeField?: (
    config: Record<string, unknown>,
    transport: TransportType,
  ) => Record<string, unknown>;
}

const transformUtils = transformer as TransformerLike;

export class ClaudeCodeAdapter extends BaseAdapter {
  id = 'claude-code';
  displayName = 'Claude Code';
  supportedTransports: TransportType[] = ['stdio', 'http', 'sse'];
  supportedScopes: ConfigScope[] = ['global', 'project'];
  restartRequired = false;
  protected rootKey = 'mcpServers';

  getConfigPaths(): ConfigPathInfo[] {
    const globalPath = this.resolvePath('~/.claude.json');
    const projectPath = '.mcp.json';

    return [
      {
        exists: existsSync(globalPath),
        path: globalPath,
        scope: 'global',
      },
      {
        exists: existsSync(projectPath),
        path: projectPath,
        scope: 'project',
      },
    ];
  }

  async detect(): Promise<boolean> {
    try {
      return this.commandExists('claude');
    } catch {
      return false;
    }
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    const config = this.toBaseServerConfig(spec);
    const addTypeField = transformUtils.addTypeField;

    if (typeof addTypeField === 'function') {
      return addTypeField(config, spec.transport);
    }

    return {
      ...config,
      type: spec.transport === 'stdio' ? 'stdio' : 'http',
    };
  }
}
