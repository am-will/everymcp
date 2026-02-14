import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

export type Platform = 'macos' | 'linux' | 'windows';
export type VSCodeVariant = 'Code' | 'Code - Insiders' | 'VSCodium';

const execFileAsync = promisify(execFile);
const WINDOWS_NPX_FALLBACK = 'C:\\Program Files\\nodejs\\npx.cmd';

export function getPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    case 'linux':
      return 'linux';
    default:
      return 'linux';
  }
}

export function expandHome(inputPath: string): string {
  if (!inputPath) {
    return inputPath;
  }

  if (inputPath === '~') {
    return os.homedir();
  }

  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function expandPercentEnvVars(template: string): string {
  return template.replace(/%([^%]+)%/g, (fullMatch: string, varName: string) => {
    const value = process.env[varName];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    return fullMatch;
  });
}

function expandDollarEnvVars(template: string): string {
  return template.replace(
    /\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (fullMatch: string, braceVar: string | undefined, simpleVar: string | undefined) => {
      const varName = braceVar ?? simpleVar;
      if (!varName) {
        return fullMatch;
      }

      const value = process.env[varName];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }

      return fullMatch;
    },
  );
}

export function resolveConfigPath(template: string): string {
  const trimmed = template.trim();
  const envExpanded = expandDollarEnvVars(expandPercentEnvVars(trimmed));
  const homeExpanded = expandHome(envExpanded);

  const looksWindowsPath =
    getPlatform() === 'windows' || /^[A-Za-z]:[\\/]/.test(homeExpanded) || homeExpanded.includes('\\');

  return looksWindowsPath ? path.win32.normalize(homeExpanded) : path.posix.normalize(homeExpanded);
}

export async function commandExists(cmd: string): Promise<boolean> {
  const trimmed = cmd.trim();
  if (!trimmed) {
    return false;
  }

  const checker = getPlatform() === 'windows' ? 'where' : 'which';

  try {
    const result = await execFileAsync(checker, [trimmed], { windowsHide: true });
    return result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function directoryExists(dir: string): Promise<boolean> {
  try {
    const info = await stat(dir);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isFile();
  } catch {
    return false;
  }
}

function resolveWindowsNpx(command: string): string {
  const normalized = path.win32.basename(command).toLowerCase();
  if (normalized !== 'npx' && normalized !== 'npx.cmd') {
    return command;
  }

  const candidates = [
    process.env.NPX_PATH,
    process.env.ProgramFiles ? path.win32.join(process.env.ProgramFiles, 'nodejs', 'npx.cmd') : undefined,
    process.env['ProgramFiles(x86)']
      ? path.win32.join(process.env['ProgramFiles(x86)'], 'nodejs', 'npx.cmd')
      : undefined,
    process.env.USERPROFILE
      ? path.win32.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm', 'npx.cmd')
      : undefined,
    WINDOWS_NPX_FALLBACK,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return 'npx.cmd';
}

export function wrapCommandForWindows(
  command: string,
  args: string[] = [],
): {
  command: string;
  args: string[];
} {
  if (getPlatform() !== 'windows') {
    return { command, args: [...args] };
  }

  const resolvedCommand = resolveWindowsNpx(command);
  return {
    command: 'cmd',
    args: ['/c', resolvedCommand, ...args],
  };
}

function detectVSCodeVariantFromRuntime(): VSCodeVariant | null {
  const signals = [
    process.execPath,
    process.env.TERM_PROGRAM,
    process.env.VSCODE_GIT_ASKPASS_MAIN,
    process.env.VSCODE_IPC_HOOK,
    process.env.VSCODE_CWD,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  if (signals.includes('insiders')) {
    return 'Code - Insiders';
  }

  if (signals.includes('codium')) {
    return 'VSCodium';
  }

  if (signals.includes('vscode') || signals.includes('code')) {
    return 'Code';
  }

  return null;
}

function getVSCodeSearchRoot(): string {
  const platform = getPlatform();
  if (platform === 'macos') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }

  if (platform === 'windows') {
    if (process.env.APPDATA) {
      return process.env.APPDATA;
    }
    return path.win32.join(os.homedir(), 'AppData', 'Roaming');
  }

  return path.join(os.homedir(), '.config');
}

export function getVSCodeVariant(): VSCodeVariant {
  const runtimeVariant = detectVSCodeVariantFromRuntime();
  if (runtimeVariant) {
    return runtimeVariant;
  }

  const root = getVSCodeSearchRoot();
  const variants: VSCodeVariant[] = ['Code', 'Code - Insiders', 'VSCodium'];

  for (const variant of variants) {
    if (existsSync(path.join(root, variant))) {
      return variant;
    }
  }

  return 'Code';
}
