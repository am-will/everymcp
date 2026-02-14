import { existsSync } from 'node:fs';

import { addExtraDefaults } from '../core/transformer.js';
import type { ConfigPathInfo, ConfigScope, McpServerSpec, TransportType } from '../types/index.js';
import { commandExists, directoryExists, resolveConfigPath } from '../utils/platform.js';
import { BaseAdapter } from './base-adapter.js';

export class NeovimAdapter extends BaseAdapter {
  id = 'neovim';
  displayName = 'Neovim (MCPHub)';
  supportedTransports: TransportType[] = ['stdio'];
  supportedScopes: ConfigScope[] = ['global'];
  restartRequired = false;

  getConfigPaths(): ConfigPathInfo[] {
    const globalPath = resolveConfigPath('~/.config/mcphub/servers.json');

    return [
      {
        scope: 'global',
        path: globalPath,
        exists: existsSync(globalPath),
      },
    ];
  }

  async detect(): Promise<boolean> {
    const [hasConfigDir, hasNeovim] = await Promise.all([
      directoryExists(resolveConfigPath('~/.config/mcphub/')),
      commandExists('nvim'),
    ]);

    return hasConfigDir || hasNeovim;
  }

  transformSpec(spec: McpServerSpec): Record<string, any> {
    const transformed: Record<string, any> = {
      command: spec.command ?? '',
      args: spec.args ?? [],
    };

    if (spec.env && Object.keys(spec.env).length > 0) {
      transformed.env = { ...spec.env };
    }

    return addExtraDefaults(transformed, {
      disabled: spec.disabled ?? false,
      autoApprove: [],
    });
  }
}

export default NeovimAdapter;
