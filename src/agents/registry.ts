import type { AgentAdapter, ConfigPathInfo, DetectedAgent } from '../types/index.js';
import * as claudeCodeModule from './claude-code.js';
import * as codexModule from './codex.js';
import * as claudeDesktopModule from './claude-desktop.js';
import * as clineModule from './cline.js';
import * as codyModule from './cody.js';
import * as cursorModule from './cursor.js';
import * as geminiCliModule from './gemini-cli.js';
import * as jetbrainsModule from './jetbrains.js';
import * as neovimModule from './neovim.js';
import * as rooCodeModule from './roo-code.js';
import * as vscodeModule from './vscode.js';
import * as windsurfModule from './windsurf.js';
import * as zedModule from './zed.js';
import * as amazonQModule from './amazon-q.js';
import * as kiloCodeModule from './kilo-code.js';

type AdapterModule = Record<string, unknown>;
type AdapterConstructor = new () => AgentAdapter;

function resolveAdapter(
  moduleRef: AdapterModule,
  adapterName: string,
  candidateNames: string[],
): AgentAdapter {
  for (const candidate of candidateNames) {
    const ctor = moduleRef[candidate];
    if (typeof ctor === 'function') {
      return new (ctor as AdapterConstructor)();
    }
  }

  const fallback = Object.entries(moduleRef).find(
    ([name, value]) => name.endsWith('Adapter') && typeof value === 'function',
  );

  if (fallback) {
    const [, ctor] = fallback;
    return new (ctor as AdapterConstructor)();
  }

  throw new Error(`Unable to resolve adapter class for ${adapterName}`);
}

const ADAPTERS: AgentAdapter[] = [
  resolveAdapter(claudeDesktopModule, 'Claude Desktop', ['ClaudeDesktopAdapter', 'ClaudeDesktop', 'default']),
  resolveAdapter(claudeCodeModule, 'Claude Code', ['ClaudeCodeAdapter', 'ClaudeCode', 'default']),
  resolveAdapter(codexModule, 'OpenAI Codex', ['CodexAdapter', 'Codex', 'default']),
  resolveAdapter(cursorModule, 'Cursor', ['CursorAdapter', 'Cursor', 'default']),
  resolveAdapter(windsurfModule, 'Windsurf', ['WindsurfAdapter', 'Windsurf', 'default']),
  resolveAdapter(vscodeModule, 'VS Code', ['VSCodeAdapter', 'VscodeAdapter', 'VisualStudioCodeAdapter', 'default']),
  resolveAdapter(zedModule, 'Zed', ['ZedAdapter', 'Zed', 'default']),
  resolveAdapter(codyModule, 'Sourcegraph Cody', ['CodyAdapter', 'Cody', 'default']),
  resolveAdapter(clineModule, 'Cline', ['ClineAdapter', 'Cline', 'default']),
  resolveAdapter(rooCodeModule, 'Roo Code', ['RooCodeAdapter', 'RooCode', 'default']),
  resolveAdapter(jetbrainsModule, 'JetBrains', ['JetBrainsAdapter', 'JetbrainsAdapter', 'JetBrainsMCPAdapter', 'default']),
  resolveAdapter(neovimModule, 'Neovim', ['NeovimAdapter', 'Neovim', 'default']),
  resolveAdapter(kiloCodeModule, 'Kilo Code', ['KiloCodeAdapter', 'KiloCode', 'default']),
  resolveAdapter(amazonQModule, 'Amazon Q', ['AmazonQAdapter', 'AmazonQ', 'default']),
  resolveAdapter(geminiCliModule, 'Gemini CLI', ['GeminiCliAdapter', 'GeminiCLIAdapter', 'GeminiCli', 'GeminiCLI', 'default']),
];

async function safeConfigPaths(adapter: AgentAdapter): Promise<ConfigPathInfo[]> {
  try {
    return await adapter.getConfigPaths();
  } catch (error) {
    console.warn(
      `Warning: failed to read config paths for ${adapter.displayName} (${adapter.id}):`,
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

export function getAllAdapters(): AgentAdapter[] {
  return [...ADAPTERS];
}

export function getAdapter(id: string): AgentAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.id === id);
}

export async function detectAll(): Promise<DetectedAgent[]> {
  const results = await Promise.allSettled(
    ADAPTERS.map(async (adapter) => {
      const detected = await adapter.detect();
      const configPaths = await safeConfigPaths(adapter);
      return { adapter, detected, configPaths };
    }),
  );

  const detectedAgents: DetectedAgent[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const adapter = ADAPTERS[index];
    if (result.status === 'fulfilled') {
      detectedAgents.push(result.value);
      continue;
    }

    const reason = result.reason;
    console.warn(
      `Warning: detect() failed for ${adapter.displayName} (${adapter.id}):`,
      reason instanceof Error ? reason.message : String(reason),
    );

    detectedAgents.push({
      adapter,
      detected: false,
      configPaths: await safeConfigPaths(adapter),
    });
  }

  return detectedAgents;
}

export async function getDetectedAdapters(): Promise<AgentAdapter[]> {
  const detected = await detectAll();
  return detected.filter((entry) => entry.detected).map((entry) => entry.adapter);
}
