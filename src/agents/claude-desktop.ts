import { existsSync } from 'node:fs';
import * as transformer from '../core/transformer.js';
import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import { BaseAdapter } from './base-adapter.js';

interface TransformerLike {
  wrapStdioForClaudeDesktopWindows?: (
    spec: McpServerSpec,
  ) => Partial<McpServerSpec> | Record<string, unknown>;
}

const transformUtils = transformer as TransformerLike;

export class ClaudeDesktopAdapter extends BaseAdapter {
  id = 'claude-desktop';
  displayName = 'Claude Desktop';
  supportedTransports: TransportType[] = ['stdio'];
  supportedScopes: ConfigScope[] = ['global'];
  restartRequired = true;
  protected rootKey = 'mcpServers';

  getConfigPaths(): ConfigPathInfo[] {
    const configPath = this.getGlobalConfigPath();
    return [
      {
        exists: existsSync(configPath),
        path: configPath,
        scope: 'global',
      },
    ];
  }

  async detect(): Promise<boolean> {
    try {
      if (await this.directoryExists(this.getGlobalConfigDirectory())) {
        return true;
      }

      if (this.getPlatform() === 'macos' && (await this.directoryExists('/Applications/Claude.app'))) {
        return true;
      }

      return this.commandExists('claude');
    } catch {
      return false;
    }
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    const config = this.toBaseServerConfig(spec);

    if (this.getPlatform() === 'windows' && spec.transport === 'stdio') {
      const wrapper = transformUtils.wrapStdioForClaudeDesktopWindows;
      if (typeof wrapper === 'function') {
        const wrapped = wrapper(spec);

        if (typeof wrapped.command === 'string') {
          config.command = wrapped.command;
        }
        if (Array.isArray(wrapped.args)) {
          config.args = [...wrapped.args];
        }
      }
    }

    return config;
  }

  private getGlobalConfigPath(): string {
    if (this.getPlatform() === 'macos') {
      return this.resolvePath('~/Library/Application Support/Claude/claude_desktop_config.json');
    }
    if (this.getPlatform() === 'windows') {
      return this.resolvePath('%APPDATA%\\Claude\\claude_desktop_config.json');
    }
    return this.resolvePath('~/.config/Claude/claude_desktop_config.json');
  }

  private getGlobalConfigDirectory(): string {
    if (this.getPlatform() === 'macos') {
      return this.resolvePath('~/Library/Application Support/Claude');
    }
    if (this.getPlatform() === 'windows') {
      return this.resolvePath('%APPDATA%\\Claude');
    }
    return this.resolvePath('~/.config/Claude');
  }
}
