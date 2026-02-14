import type { McpServerSpec, TransportType } from './server-spec.js';

type JsonValue = string | number | boolean | null | JsonValue[] | JsonRecord;
interface JsonRecord {
  [key: string]: JsonValue;
}

const DEFAULT_WINDOWS_NPX_PATH = 'C:\\Program Files\\nodejs\\npx.cmd';

export function addTypeField<T extends JsonRecord>(
  config: T,
  transport: TransportType
): T & { type: 'stdio' | 'http' } {
  return {
    ...config,
    type: transport === 'stdio' ? 'stdio' : 'http',
  };
}

export function addWindsurfFields<T extends JsonRecord>(
  config: T
): Omit<T, 'url'> & { serverUrl?: JsonValue; disabled: boolean; alwaysAllow: JsonValue[] } {
  const transformed: JsonRecord = { ...config };

  if ('url' in transformed && !('serverUrl' in transformed)) {
    transformed.serverUrl = transformed.url;
    delete transformed.url;
  }

  if (!('disabled' in transformed)) {
    transformed.disabled = false;
  }

  if (!('alwaysAllow' in transformed)) {
    transformed.alwaysAllow = [];
  }

  return transformed as Omit<T, 'url'> & {
    serverUrl?: JsonValue;
    disabled: boolean;
    alwaysAllow: JsonValue[];
  };
}

export function addZedFields<T extends JsonRecord>(config: T): T & { source: 'custom' } {
  return {
    ...config,
    source: 'custom',
  };
}

export function addExtraDefaults<T extends JsonRecord>(
  config: T,
  fields: Record<string, JsonValue>
): T & Record<string, JsonValue> {
  const transformed: JsonRecord = { ...config };

  for (const [key, value] of Object.entries(fields)) {
    if (transformed[key] === undefined) {
      transformed[key] = value;
    }
  }

  return transformed as T & Record<string, JsonValue>;
}

export function wrapStdioForClaudeDesktopWindows(
  spec: McpServerSpec,
  platform: NodeJS.Platform = process.platform
): McpServerSpec {
  if (platform !== 'win32' || spec.transport !== 'stdio' || !spec.command) {
    return cloneSpec(spec);
  }

  const existingArgs = Array.isArray(spec.args) ? [...spec.args] : [];
  if (spec.command.toLowerCase() === 'cmd' && existingArgs[0]?.toLowerCase() === '/c') {
    return {
      ...cloneSpec(spec),
      args: existingArgs,
    };
  }

  const resolvedCommand = resolveWindowsCommand(spec.command);
  return {
    ...cloneSpec(spec),
    command: 'cmd',
    args: ['/c', resolvedCommand, ...existingArgs],
  };
}

function resolveWindowsCommand(command: string): string {
  const lower = command.trim().toLowerCase();
  if (lower === 'npx' || lower.endsWith('\\npx') || lower.endsWith('/npx')) {
    return DEFAULT_WINDOWS_NPX_PATH;
  }

  if (lower.endsWith('\\npx.cmd') || lower.endsWith('/npx.cmd')) {
    return command;
  }

  return command;
}

function cloneSpec(spec: McpServerSpec): McpServerSpec {
  return {
    ...spec,
    args: spec.args ? [...spec.args] : spec.args,
    headers: spec.headers ? { ...spec.headers } : spec.headers,
    env: spec.env ? { ...spec.env } : spec.env,
    oauth: spec.oauth ? { ...spec.oauth } : spec.oauth,
  };
}
