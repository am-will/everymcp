export type ParsedServerInput =
  | {
      kind: 'url';
      transport: 'http' | 'sse';
      url: string;
      raw: string;
    }
  | {
      kind: 'command';
      transport: 'stdio';
      command: string;
      args: string[];
      raw: string;
    }
  | {
      kind: 'registry';
      name: string;
      raw: string;
    };

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_KEY_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const URL_PROTOCOLS = new Set(['http:', 'https:', 'sse:']);

const KNOWN_COMMANDS = new Set([
  'bash',
  'bun',
  'cmd',
  'deno',
  'node',
  'npm',
  'npx',
  'pnpm',
  'powershell',
  'pwsh',
  'python',
  'python3',
  'sh',
  'uv',
  'uvx',
  'yarn',
]);

export function validateUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return URL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function inferTransportFromUrl(parsed: URL): 'http' | 'sse' {
  if (parsed.protocol === 'sse:') {
    return 'sse';
  }

  const pathName = parsed.pathname.toLowerCase();
  const transport = parsed.searchParams.get('transport')?.toLowerCase();
  const type = parsed.searchParams.get('type')?.toLowerCase();

  if (transport === 'sse' || type === 'sse') {
    return 'sse';
  }

  if (pathName.endsWith('/sse') || pathName.includes('/events')) {
    return 'sse';
  }

  return 'http';
}

function parseCommandTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (char === '\\' && quote !== "'") {
      const next = input[i + 1];
      if (next !== undefined) {
        current += next;
        i += 1;
        continue;
      }
    }

    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      continue;
    }

    if (quote === char) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && quote === null) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (quote !== null) {
    throw new Error('Unterminated quote in command input.');
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function isPathLike(value: string): boolean {
  if (!value) {
    return false;
  }

  return (
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('~/') ||
    value.startsWith('.\\') ||
    value.startsWith('..\\') ||
    /^[A-Za-z]:\\/.test(value) ||
    value.includes('\\')
  );
}

function looksLikeCommand(raw: string, tokens: string[]): boolean {
  if (tokens.length > 1) {
    return true;
  }

  const token = tokens[0];
  if (!token) {
    return false;
  }

  if (KNOWN_COMMANDS.has(token.toLowerCase())) {
    return true;
  }

  if (isPathLike(token)) {
    return true;
  }

  if (/\.(cmd|bat|exe|sh|ps1|js|mjs|cjs|ts)$/i.test(token)) {
    return true;
  }

  if (raw.startsWith('-')) {
    return true;
  }

  return false;
}

function isRegistryName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._@/-]*$/.test(value);
}

export function parseServerInput(input: string): ParsedServerInput {
  const raw = input.trim();
  if (!raw) {
    throw new Error('Server input is required.');
  }

  if (validateUrl(raw)) {
    const parsed = new URL(raw);
    return {
      kind: 'url',
      transport: inferTransportFromUrl(parsed),
      url: parsed.toString(),
      raw,
    };
  }

  const tokens = parseCommandTokens(raw);
  if (tokens.length === 0) {
    throw new Error('Server input is required.');
  }

  if (looksLikeCommand(raw, tokens)) {
    return {
      kind: 'command',
      transport: 'stdio',
      command: tokens[0],
      args: tokens.slice(1),
      raw,
    };
  }

  if (tokens.length === 1 && isRegistryName(tokens[0])) {
    return {
      kind: 'registry',
      name: tokens[0],
      raw,
    };
  }

  return {
    kind: 'command',
    transport: 'stdio',
    command: tokens[0],
    args: tokens.slice(1),
    raw,
  };
}

function parseKeyValuePairs(
  values: string[],
  label: string,
  keyPattern: RegExp,
): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const value of values) {
    const raw = value.trim();
    if (!raw) {
      continue;
    }

    const separatorIndex = raw.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid ${label} "${value}". Expected KEY=VALUE format.`);
    }

    const key = raw.slice(0, separatorIndex).trim();
    const parsedValue = raw.slice(separatorIndex + 1).trim();

    if (!keyPattern.test(key)) {
      throw new Error(`Invalid ${label} key "${key}".`);
    }

    parsed[key] = parsedValue;
  }

  return parsed;
}

export function validateEnvVars(vars: string[]): Record<string, string> {
  return parseKeyValuePairs(vars, 'environment variable', ENV_KEY_PATTERN);
}

export function validateHeaders(headers: string[]): Record<string, string> {
  return parseKeyValuePairs(headers, 'header', HEADER_KEY_PATTERN);
}
