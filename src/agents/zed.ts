import { existsSync } from 'node:fs';
import * as transformer from '../core/transformer.js';
import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import { BaseAdapter } from './base-adapter.js';

interface TransformerLike {
  addZedFields?: (config: Record<string, unknown>) => Record<string, unknown>;
}

const transformUtils = transformer as TransformerLike;

export class ZedAdapter extends BaseAdapter {
  id = 'zed';
  displayName = 'Zed';
  supportedTransports: TransportType[] = ['stdio', 'http'];
  supportedScopes: ConfigScope[] = ['global', 'project'];
  restartRequired = false;
  protected rootKey = 'context_servers';

  getConfigPaths(): ConfigPathInfo[] {
    const globalPath = this.getGlobalSettingsPath();
    const projectPath = '.zed/settings.json';

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
      if (await this.directoryExists(this.getGlobalConfigDirectory())) {
        return true;
      }
      return this.commandExists('zed');
    } catch {
      return false;
    }
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    const config = this.toBaseServerConfig(spec);
    const addZedFields = transformUtils.addZedFields;

    if (typeof addZedFields === 'function') {
      return addZedFields(config);
    }

    return {
      ...config,
      source: 'custom',
    };
  }

  private getGlobalSettingsPath(): string {
    if (this.getPlatform() === 'windows') {
      return this.resolvePath('%APPDATA%\\Zed\\settings.json');
    }
    return this.resolvePath('~/.config/zed/settings.json');
  }

  private getGlobalConfigDirectory(): string {
    if (this.getPlatform() === 'windows') {
      return this.resolvePath('%APPDATA%\\Zed');
    }
    return this.resolvePath('~/.config/zed');
  }
}
