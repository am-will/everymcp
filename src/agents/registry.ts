import type { AgentAdapter, DetectedAgent } from '../types/index.js';

import * as AmazonQModule from './amazon-q.js';
import * as ClaudeCodeModule from './claude-code.js';
import * as ClaudeDesktopModule from './claude-desktop.js';
import * as ClineModule from './cline.js';
import * as CodyModule from './cody.js';
import * as CursorModule from './cursor.js';
import * as GeminiCliModule from './gemini-cli.js';
import * as JetBrainsModule from './jetbrains.js';
import * as KiloCodeModule from './kilo-code.js';
import * as NeovimModule from './neovim.js';
import * as RooCodeModule from './roo-code.js';
import * as VSCodeModule from './vscode.js';
import * as WindsurfModule from './windsurf.js';
import * as ZedModule from './zed.js';

type AdapterCtor = new () => AgentAdapter;

function resolveAdapterCtor(moduleExports: Record<string, unknown>, preferredExport: string): AdapterCtor {
  const preferred = moduleExports[preferredExport];
  if (typeof preferred === 'function') {
    return preferred as AdapterCtor;
  }

  const maybeDefault = moduleExports.default;
  if (typeof maybeDefault === 'function') {
    return maybeDefault as AdapterCtor;
  }

  for (const value of Object.values(moduleExports)) {
    if (typeof value === 'function') {
      return value as AdapterCtor;
    }
  }

  throw new Error(`Unable to resolve adapter constructor: ${preferredExport}`);
}

function buildDefaultAdapters(): AgentAdapter[] {
  return [
    new (resolveAdapterCtor(ClaudeDesktopModule as Record<string, unknown>, 'ClaudeDesktopAdapter'))(),
    new (resolveAdapterCtor(ClaudeCodeModule as Record<string, unknown>, 'ClaudeCodeAdapter'))(),
    new (resolveAdapterCtor(CursorModule as Record<string, unknown>, 'CursorAdapter'))(),
    new (resolveAdapterCtor(WindsurfModule as Record<string, unknown>, 'WindsurfAdapter'))(),
    new (resolveAdapterCtor(VSCodeModule as Record<string, unknown>, 'VSCodeAdapter'))(),
    new (resolveAdapterCtor(ZedModule as Record<string, unknown>, 'ZedAdapter'))(),
    new (resolveAdapterCtor(CodyModule as Record<string, unknown>, 'CodyAdapter'))(),
    new (resolveAdapterCtor(ClineModule as Record<string, unknown>, 'ClineAdapter'))(),
    new (resolveAdapterCtor(RooCodeModule as Record<string, unknown>, 'RooCodeAdapter'))(),
    new (resolveAdapterCtor(JetBrainsModule as Record<string, unknown>, 'JetBrainsAdapter'))(),
    new (resolveAdapterCtor(NeovimModule as Record<string, unknown>, 'NeovimAdapter'))(),
    new (resolveAdapterCtor(KiloCodeModule as Record<string, unknown>, 'KiloCodeAdapter'))(),
    new (resolveAdapterCtor(AmazonQModule as Record<string, unknown>, 'AmazonQAdapter'))(),
    new (resolveAdapterCtor(GeminiCliModule as Record<string, unknown>, 'GeminiCliAdapter'))(),
  ];
}

export class AgentRegistry {
  private readonly adapters: AgentAdapter[];
  private readonly adaptersById: Map<string, AgentAdapter>;
  private detectedAgents: DetectedAgent[] = [];

  constructor(adapters: AgentAdapter[] = buildDefaultAdapters()) {
    this.adapters = [...adapters];
    this.adaptersById = new Map(this.adapters.map((adapter) => [adapter.id, adapter]));
  }

  getAdapter(id: string): AgentAdapter | undefined {
    return this.adaptersById.get(id);
  }

  getAllAdapters(): AgentAdapter[] {
    return [...this.adapters];
  }

  getDetectedAdapters(): DetectedAgent[] {
    return this.detectedAgents.filter((entry) => entry.detected);
  }

  async detectAll(): Promise<DetectedAgent[]> {
    const detectionResults = await Promise.allSettled(
      this.adapters.map(async (adapter) => {
        const detected = await adapter.detect();
        return {
          adapter,
          detected,
          configPaths: adapter.getConfigPaths(),
        } satisfies DetectedAgent;
      }),
    );

    const detectedAgents: DetectedAgent[] = [];

    for (let index = 0; index < detectionResults.length; index += 1) {
      const result = detectionResults[index];
      const adapter = this.adapters[index];

      if (result.status === 'fulfilled') {
        detectedAgents.push(result.value);
        continue;
      }

      const reasonMessage =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`[everymcp] Adapter detection failed for "${adapter.id}": ${reasonMessage}`);

      detectedAgents.push({
        adapter,
        detected: false,
        configPaths: adapter.getConfigPaths(),
      });
    }

    this.detectedAgents = detectedAgents;
    return detectedAgents;
  }
}

export const agentRegistry = new AgentRegistry();

export async function detectAll(): Promise<DetectedAgent[]> {
  return agentRegistry.detectAll();
}

export function getAdapter(id: string): AgentAdapter | undefined {
  return agentRegistry.getAdapter(id);
}

export function getAllAdapters(): AgentAdapter[] {
  return agentRegistry.getAllAdapters();
}

export function getDetectedAdapters(): DetectedAgent[] {
  return agentRegistry.getDetectedAdapters();
}
