import { McpServerSpec, TransportType } from './server-spec.js';

const WINDOWS_NPX_PATH = 'C:\\Program Files\\nodejs\\npx.cmd';

function isWindowsRuntime(): boolean {
  const processPlatform = (globalThis as unknown as { process?: { platform?: string } }).process?.platform;
  return processPlatform === 'win32';
}

function resolveNpxPath(command: string): string {
  const base = command.split(/[\\/]/).pop() ?? command;
  return /^npx(?:\.cmd)?$/i.test(base) ? WINDOWS_NPX_PATH : command;
}

export function addTypeField(config: Record<string, any>, transport: TransportType): Record<string, any> {
  return {
    ...config,
    type: transport === 'stdio' ? 'stdio' : 'http',
  };
}

export function addWindsurfFields(config: Record<string, any>): Record<string, any> {
  const serverUrl = config.url;
  const next = { ...config };

  if (serverUrl && !next.serverUrl) {
    next.serverUrl = serverUrl;
    delete next.url;
  }

  if (next.disabled === undefined) {
    next.disabled = false;
  }

  if (next.alwaysAllow === undefined) {
    next.alwaysAllow = [];
  }

  return next;
}

export function addZedFields(config: Record<string, any>): Record<string, any> {
  return {
    ...config,
    source: config.source ?? 'custom',
  };
}

export function addExtraDefaults(config: Record<string, any>, fields: Record<string, any>): Record<string, any> {
  return {
    ...fields,
    ...Object.fromEntries(
      Object.entries(config).filter(([, value]) => value !== undefined),
    ),
  };
}

export function wrapStdioForClaudeDesktopWindows(spec: McpServerSpec): McpServerSpec {
  if (!isWindowsRuntime() || spec.transport !== 'stdio' || !spec.command) {
    return spec;
  }

  const existingCommand = spec.command;
  if (existingCommand.toLowerCase() === 'cmd' && spec.args?.[0] === '/c') {
    return spec;
  }

  const resolvedCommand = resolveNpxPath(existingCommand);
  return {
    ...spec,
    command: 'cmd',
    args: ['/c', resolvedCommand, ...(spec.args ?? [])],
  };
}
