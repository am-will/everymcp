import { basename } from 'node:path';

export type TransportType = 'stdio' | 'http' | 'sse';

export interface McpServerSpec {
  name: string;
  transport: TransportType;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  oauth?: {
    clientId?: string;
    callbackPort?: number;
  };
  disabled?: boolean;
}

export interface ParseServerSpecOverrides {
  name?: string;
  env?: string[] | Record<string, string>;
  headers?: string[] | Record<string, string>;
  header?: string[] | Record<string, string>;
  authToken?: string;
  oauthClientId?: string;
  oauthCallbackPort?: number;
  transport?: TransportType | string;
  disabled?: boolean;
}

interface ParsedCommand {
  command: string;
  args: string[];
}

const REMOTE_PROTOCOLS = new Set(['http:', 'https:']);
const AUTH_HEADER = 'authorization';
const DEFAULT_SERVER_NAME = 'server';

export function parseServerSpec(input: string, overrides: ParseServerSpecOverrides = {}): McpServerSpec {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    throw new Error('Server input is required.');
  }

  const forcedTransport = normalizeTransport(overrides.transport);
  const inferredTransport = inferTransport(trimmedInput);
  const transport = forcedTransport ?? inferredTransport;

  const spec: McpServerSpec =
    transport === 'stdio'
      ? parseStdioSpec(trimmedInput)
      : parseRemoteSpec(trimmedInput, transport);

  const env = parseKeyValuePairs(overrides.env, '--env');
  if (env) {
    spec.env = env;
  }

  const parsedHeaders = parseKeyValuePairs(overrides.headers ?? overrides.header, '--header');
  const headers = withAuthHeader(parsedHeaders, overrides.authToken);
  if (headers) {
    spec.headers = headers;
  }

  const oauth = buildOAuthOverrides(overrides.oauthClientId, overrides.oauthCallbackPort);
  if (oauth) {
    spec.oauth = oauth;
  }

  if (typeof overrides.disabled === 'boolean') {
    spec.disabled = overrides.disabled;
  }

  spec.name = buildServerName(spec, overrides.name);
  return spec;
}

export function splitCommandString(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (!quote) {
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }

      if (char === '\\') {
        const next = input[index + 1];
        if (next && (/\s/.test(next) || next === "'" || next === '"' || next === '\\')) {
          current += next;
          index += 1;
          continue;
        }
        current += char;
        continue;
      }

      if (/\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      current += char;
      continue;
    }

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      quote = null;
      continue;
    }

    if (char === '\\') {
      const next = input[index + 1];
      if (next && (next === '"' || next === '\\')) {
        current += next;
        index += 1;
        continue;
      }
      current += char;
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error(`Unterminated ${quote === "'" ? 'single' : 'double'} quote in command input.`);
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function parseCommandString(input: string): ParsedCommand {
  const tokens = splitCommandString(input.trim());
  if (tokens.length === 0) {
    throw new Error('Command input must include at least one token.');
  }

  const [command, ...args] = tokens;
  return { command, args };
}

export function parseKeyValuePairs(
  values: string[] | Record<string, string> | undefined,
  flagName: string
): Record<string, string> | undefined {
  if (!values) {
    return undefined;
  }

  const output: Record<string, string> = {};

  if (Array.isArray(values)) {
    for (const rawEntry of values) {
      const entry = rawEntry.trim();
      if (!entry) {
        continue;
      }

      const separator = entry.indexOf('=');
      if (separator <= 0) {
        throw new Error(`Invalid ${flagName} value "${rawEntry}". Expected KEY=VALUE.`);
      }

      const key = entry.slice(0, separator).trim();
      if (!key) {
        throw new Error(`Invalid ${flagName} value "${rawEntry}". Key cannot be empty.`);
      }

      output[key] = entry.slice(separator + 1);
    }
  } else {
    for (const [rawKey, rawValue] of Object.entries(values)) {
      const key = rawKey.trim();
      if (!key) {
        throw new Error(`Invalid ${flagName} record. Key cannot be empty.`);
      }
      output[key] = String(rawValue);
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function parseStdioSpec(input: string): McpServerSpec {
  const { command, args } = parseCommandString(input);
  return {
    name: '',
    transport: 'stdio',
    command,
    args,
  };
}

function parseRemoteSpec(input: string, transport: Exclude<TransportType, 'stdio'>): McpServerSpec {
  const parsedUrl = parseHttpUrl(input);
  return {
    name: '',
    transport,
    url: parsedUrl.toString(),
  };
}

function inferTransport(input: string): TransportType {
  if (!isHttpUrl(input)) {
    return 'stdio';
  }
  return detectRemoteTransport(input);
}

export function detectRemoteTransport(input: string): Exclude<TransportType, 'stdio'> {
  const parsedUrl = parseHttpUrl(input);
  const pathname = parsedUrl.pathname.toLowerCase();
  const hash = parsedUrl.hash.toLowerCase();
  const transportHint = (parsedUrl.searchParams.get('transport') ?? '').toLowerCase();

  const hasSseHint =
    pathname.endsWith('/sse') ||
    pathname.includes('/sse/') ||
    hash.includes('sse') ||
    transportHint === 'sse';

  return hasSseHint ? 'sse' : 'http';
}

function isHttpUrl(value: string): boolean {
  try {
    if (typeof URL.canParse === 'function' && !URL.canParse(value)) {
      return false;
    }
    const parsed = new URL(value);
    return REMOTE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function parseHttpUrl(value: string): URL {
  try {
    const parsed = new URL(value);
    if (!REMOTE_PROTOCOLS.has(parsed.protocol)) {
      throw new Error(
        `Unsupported URL protocol "${parsed.protocol}". Only http and https are supported.`
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid URL input "${value}": ${error.message}`);
    }
    throw new Error(`Invalid URL input "${value}".`);
  }
}

function normalizeTransport(transport: ParseServerSpecOverrides['transport']): TransportType | undefined {
  if (transport === undefined) {
    return undefined;
  }

  const normalized = String(transport).trim().toLowerCase() as TransportType;
  if (normalized === 'stdio' || normalized === 'http' || normalized === 'sse') {
    return normalized;
  }

  throw new Error(
    `Unsupported transport "${transport}". Expected one of: stdio, http, sse.`
  );
}

function withAuthHeader(
  headers: Record<string, string> | undefined,
  authToken: string | undefined
): Record<string, string> | undefined {
  const token = authToken?.trim();
  if (!token) {
    return headers;
  }

  const output = { ...(headers ?? {}) };
  const hasAuthorizationHeader = Object.keys(output).some(
    (key) => key.trim().toLowerCase() === AUTH_HEADER
  );

  if (!hasAuthorizationHeader) {
    output.Authorization = `Bearer ${token}`;
  }

  return output;
}

function buildOAuthOverrides(
  oauthClientId: string | undefined,
  oauthCallbackPort: number | undefined
): McpServerSpec['oauth'] | undefined {
  const oauth: NonNullable<McpServerSpec['oauth']> = {};

  if (oauthClientId?.trim()) {
    oauth.clientId = oauthClientId.trim();
  }

  if (oauthCallbackPort !== undefined) {
    if (!Number.isInteger(oauthCallbackPort) || oauthCallbackPort <= 0) {
      throw new Error(
        `Invalid --oauth-callback-port "${oauthCallbackPort}". Expected a positive integer.`
      );
    }
    oauth.callbackPort = oauthCallbackPort;
  }

  return Object.keys(oauth).length > 0 ? oauth : undefined;
}

function buildServerName(spec: McpServerSpec, overrideName: string | undefined): string {
  if (overrideName?.trim()) {
    return overrideName.trim();
  }

  if (spec.transport === 'stdio') {
    return inferNameFromCommand(spec.command ?? '', spec.args ?? []);
  }

  return inferNameFromUrl(spec.url ?? '');
}

function inferNameFromCommand(command: string, args: string[]): string {
  const commandName = basename(command).replace(/\.(exe|cmd|bat|sh)$/i, '');

  if (commandName.toLowerCase() === 'npx') {
    const packageArg = args.find((arg) => !arg.startsWith('-'));
    if (packageArg) {
      const normalizedPackage = packageArg.split('/').filter(Boolean).pop() ?? packageArg;
      return sanitizeServerName(normalizedPackage);
    }
  }

  return sanitizeServerName(commandName);
}

function inferNameFromUrl(url: string): string {
  const parsedUrl = parseHttpUrl(url);
  const pathLastSegment = parsedUrl.pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .pop();

  const candidate = [parsedUrl.hostname.replace(/^www\./i, ''), pathLastSegment]
    .filter(Boolean)
    .join('-');

  return sanitizeServerName(candidate);
}

function sanitizeServerName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || DEFAULT_SERVER_NAME;
}
