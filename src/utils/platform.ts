import { accessSync, constants, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { platform as nodePlatform, homedir } from 'node:os';
import * as path from 'node:path';

export type Platform = 'macos' | 'linux' | 'windows';

export type VSCodeVariant = 'Code' | 'Code - Insiders' | 'VSCodium' | 'Antigravity';

export interface WrappedCommand {
  command: string;
  args: string[];
}

function stripOuterQuotes(value: string): string {
  if (value.length >= 2) {
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function resolveWindowsPlaceholders(value: string): string {
  return value.replace(/%([^%]+)%/g, (_match, varName: string) => {
    const envValue = process.env[varName] || process.env[varName.toUpperCase()];
    if (envValue && envValue.length > 0) {
      return envValue;
    }
    return _match;
  });
}

function quoteForCmd(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (/[\s&|^<>]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

export function getPlatform(): Platform {
  switch (nodePlatform()) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    default:
      return 'linux';
  }
}

export function expandHome(p: string): string {
  if (!p || !p.startsWith('~')) {
    return p;
  }
  const home = homedir();
  if (!home) {
    return p;
  }
  if (p === '~') {
    return home;
  }
  if (!p.startsWith('~/') && !p.startsWith('~\\') && !p.startsWith('~/.') && !p.startsWith('~\\.')) {
    return p;
  }
  return path.join(home, p.slice(2));
}

export function resolveConfigPath(template: string): string {
  if (!template) {
    return template;
  }
  const expandedEnv = resolveWindowsPlaceholders(template);
  const expandedHome = expandHome(expandedEnv);
  if (!path.isAbsolute(expandedHome)) {
    return path.normalize(expandedHome);
  }
  return path.normalize(expandedHome);
}

export function commandExists(cmd: string): boolean {
  const normalizedCommand = stripOuterQuotes(cmd.trim());
  if (!normalizedCommand) {
    return false;
  }

  const isPathLike =
    normalizedCommand.includes(path.sep) ||
    normalizedCommand.includes('/') ||
    normalizedCommand.includes('\\') ||
    path.isAbsolute(normalizedCommand);

  if (isPathLike) {
    try {
      accessSync(normalizedCommand, constants.X_OK);
      const stats = statSync(normalizedCommand);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  const commandName = normalizedCommand;
  const checkCommand = getPlatform() === 'windows' ? 'where' : 'which';
  const result = spawnSync(checkCommand, [commandName], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  return result.status === 0 && Boolean((result.stdout || '').toString().trim());
}

export async function directoryExists(dir: string): Promise<boolean> {
  try {
    const stats = await stat(dir);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    const stats = await stat(file);
    return stats.isFile();
  } catch {
    return false;
  }
}

function getNpxExecutable(): string | null {
  if (getPlatform() !== 'windows') {
    return null;
  }
  const resolved = spawnSync('where', ['npx'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (resolved.status !== 0) {
    return null;
  }
  const firstLine = (resolved.stdout || '').toString().split(/\r?\n/)[0]?.trim();
  if (!firstLine) {
    return null;
  }
  return firstLine;
}

export function wrapCommandForWindows(command: string, args: string[] = []): WrappedCommand {
  if (getPlatform() !== 'windows') {
    return { command, args };
  }

  const trimmedCommand = stripOuterQuotes(command.trim());
  const normalizedCommand =
    trimmedCommand.toLowerCase() === 'npx' ? getNpxExecutable() || trimmedCommand : trimmedCommand;
  const commandLine = [quoteForCmd(normalizedCommand), ...args.map(quoteForCmd)].join(' ').trim();
  return {
    command: 'cmd',
    args: ['/c', commandLine],
  };
}

export function getVSCodeVariant(): VSCodeVariant {
  if (commandExists('antigravity')) {
    return 'Antigravity';
  }

  if (getPlatform() === 'windows') {
    if (commandExists('code-insiders')) {
      return 'Code - Insiders';
    }
    if (commandExists('codium')) {
      return 'VSCodium';
    }
    if (commandExists('code')) {
      return 'Code';
    }
    return 'Code';
  }

  if (commandExists('code-insiders') || commandExists('codium')) {
    if (commandExists('code-insiders')) {
      return 'Code - Insiders';
    }
    return 'VSCodium';
  }

  if (commandExists('code')) {
    return 'Code';
  }

  return 'Code';
}
