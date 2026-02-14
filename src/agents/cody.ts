import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import * as platform from '../utils/platform.js';
import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import { BaseAdapter } from './base-adapter.js';

interface PlatformLike {
  getVSCodeVariant?: () => string;
}

const platformUtils = platform as PlatformLike;

export class CodyAdapter extends BaseAdapter {
  id = 'cody';
  displayName = 'Sourcegraph Cody';
  supportedTransports: TransportType[] = ['stdio'];
  supportedScopes: ConfigScope[] = ['global', 'project'];
  restartRequired = false;
  protected rootKey = 'mcpServers';

  getConfigPaths(): ConfigPathInfo[] {
    const globalPath = this.getUserSettingsPath();
    const projectPath = '.vscode/settings.json';

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
      for (const extensionsDir of this.getExtensionDirectories()) {
        if (!(await this.directoryExists(extensionsDir))) {
          continue;
        }

        const entries = await readdir(extensionsDir, { withFileTypes: true });
        const codyInstalled = entries.some(
          (entry) =>
            entry.isDirectory() &&
            entry.name.toLowerCase().startsWith('sourcegraph.cody-ai'),
        );

        if (codyInstalled) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  transformSpec(spec: McpServerSpec): Record<string, unknown> {
    return this.toBaseServerConfig(spec);
  }

  protected getRootPath(_scope: ConfigScope): Array<string | number> {
    return ['cody', 'mcpServers'];
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

  private getExtensionDirectories(): string[] {
    if (this.getPlatform() === 'windows') {
      return [
        this.resolvePath('%USERPROFILE%\\.vscode\\extensions'),
        this.resolvePath('%USERPROFILE%\\.vscode-insiders\\extensions'),
        this.resolvePath('%USERPROFILE%\\.vscode-oss\\extensions'),
      ];
    }

    return [
      this.resolvePath('~/.vscode/extensions'),
      this.resolvePath('~/.vscode-insiders/extensions'),
      this.resolvePath('~/.vscode-oss/extensions'),
    ];
  }
}
