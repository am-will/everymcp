import { existsSync } from 'node:fs';
import * as platform from '../utils/platform.js';
import * as transformer from '../core/transformer.js';
import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import { BaseAdapter } from './base-adapter.js';

interface PlatformLike {
  getVSCodeVariant?: () => string;
}

interface TransformerLike {
  addTypeField?: (
    config: Record<string, unknown>,
    transport: TransportType,
  ) => Record<string, unknown>;
}

const platformUtils = platform as PlatformLike;
const transformUtils = transformer as TransformerLike;

export class VSCodeAdapter extends BaseAdapter {
  id = 'vscode';
  displayName = 'VS Code';
  supportedTransports: TransportType[] = ['stdio', 'http', 'sse'];
  supportedScopes: ConfigScope[] = ['global', 'project'];
  restartRequired = false;
  protected rootKey = 'servers';

  getConfigPaths(): ConfigPathInfo[] {
    const globalPath = this.getUserSettingsPath();
    const projectPath = '.vscode/mcp.json';

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
      if (await this.commandExists('code')) {
        return true;
      }
      if (await this.commandExists('code-insiders')) {
        return true;
      }
      if (await this.commandExists('codium')) {
        return true;
      }
      return existsSync(this.getUserSettingsPath());
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

  protected getRootPath(scope: ConfigScope): Array<string | number> {
    if (scope === 'global') {
      return ['mcp.servers'];
    }
    return ['servers'];
  }

  private getVSCodeVariant(): string {
    if (typeof platformUtils.getVSCodeVariant === 'function') {
      return platformUtils.getVSCodeVariant();
    }

    return 'Code';
  }

  private getUserSettingsPath(): string {
    const variant = this.getVSCodeVariant();

    if (this.getPlatform() === 'macos') {
      return this.resolvePath(`~/Library/Application Support/${variant}/User/settings.json`);
    }
    if (this.getPlatform() === 'windows') {
      return this.resolvePath(`%APPDATA%\\${variant}\\User\\settings.json`);
    }
    return this.resolvePath(`~/.config/${variant}/User/settings.json`);
  }
}
