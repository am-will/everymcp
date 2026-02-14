import { existsSync } from 'node:fs';
import * as transformer from '../core/transformer.js';
import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import { BaseAdapter } from './base-adapter.js';

interface TransformerLike {
  addExtraDefaults?: (
    config: Record<string, unknown>,
    fields: Record<string, unknown>,
  ) => Record<string, unknown>;
  addWindsurfFields?: (config: Record<string, unknown>) => Record<string, unknown>;
}

const transformUtils = transformer as TransformerLike;

export class WindsurfAdapter extends BaseAdapter {
  id = 'windsurf';
  displayName = 'Windsurf';
  supportedTransports: TransportType[] = ['stdio', 'http', 'sse'];
  supportedScopes: ConfigScope[] = ['global'];
  restartRequired = false;
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
      return this.directoryExists(this.getGlobalConfigDirectory());
    } catch {
      return false;
    }
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    let config = this.toBaseServerConfig(spec);

    if (spec.transport !== 'stdio' && typeof config.url === 'string') {
      config = {
        ...config,
        serverUrl: config.url,
      };
      delete config.url;
    }

    const addWindsurfFields = transformUtils.addWindsurfFields;
    if (typeof addWindsurfFields === 'function') {
      config = addWindsurfFields(config);
    }

    const addExtraDefaults = transformUtils.addExtraDefaults;
    if (typeof addExtraDefaults === 'function') {
      config = addExtraDefaults(config, { alwaysAllow: [], disabled: false });
    } else {
      if (!Array.isArray(config.alwaysAllow)) {
        config.alwaysAllow = [];
      }
      if (typeof config.disabled !== 'boolean') {
        config.disabled = false;
      }
    }

    return config;
  }

  private getGlobalConfigPath(): string {
    if (this.getPlatform() === 'windows') {
      return this.resolvePath('%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json');
    }
    return this.resolvePath('~/.codeium/windsurf/mcp_config.json');
  }

  private getGlobalConfigDirectory(): string {
    if (this.getPlatform() === 'windows') {
      return this.resolvePath('%USERPROFILE%\\.codeium\\windsurf');
    }
    return this.resolvePath('~/.codeium/windsurf');
  }
}
