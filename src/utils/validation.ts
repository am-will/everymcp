import { commandExists } from './platform.js';

export type ParsedServerInput =
  | { kind: 'url'; transport: 'http' | 'sse'; value: string }
  | { kind: 'command'; command: string; args: string[] }
  | { kind: 'registry'; name: string };

function isQuotedCommandInput(input: string): boolean {
  return input.startsWith('"') || input.startsWith('\'');
}

function parseQuotedCommand(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  const args: string[] = [];
  let token = '';
  let tokenStarted = false;
  let quote: null | 'single' | 'double' = null;

  const pushToken = () => {
    if (tokenStarted) {
      args.push(token);
    }
    token = '';
    tokenStarted = false;
  };

  for (let index = 0; index < trimmed.length; index += 1) {
    const current = trimmed[index];
    const next = trimmed[index + 1];

    if (quote === null) {
      if (current === ' ' || current === '\t' || current === '\n' || current === '\r') {
        pushToken();
        continue;
      }
      if (current === '"') {
        quote = 'double';
        tokenStarted = true;
        continue;
      }
      if (current === '\'') {
        quote = 'single';
        tokenStarted = true;
        continue;
      }
      if (current === '\\' && next !== undefined) {
        if (next === ' ' || next === '\t' || next === '"' || next === '\'' || next === '\\') {
          token += next;
          tokenStarted = true;
          index += 1;
          continue;
        }
      }
      token += current;
      tokenStarted = true;
      continue;
    }

    if (quote === 'single') {
      if (current === '\'') {
        quote = null;
        continue;
      }
      token += current;
      continue;
    }

    if (quote === 'double') {
      if (current === '\\' && next !== undefined) {
        if (next === '\\' || next === '"' || next === '$' || next === '`') {
          token += next;
          index += 1;
          continue;
        }
      }
      if (current === '"') {
        quote = null;
        continue;
      }
      token += current;
      continue;
    }
  }

  if (quote !== null) {
    throw new Error('unterminated quote in command input');
  }

  pushToken();
  return args;
}

function inferTransport(url: string): 'http' | 'sse' {
  try {
    const parsed = new URL(url);
    const transport = parsed.searchParams.get('transport')?.toLowerCase();
    if (transport === 'sse') {
      return 'sse';
    }
    if (parsed.pathname.endsWith('/sse') || parsed.pathname === '/sse') {
      return 'sse';
    }
    return 'http';
  } catch {
    return 'http';
  }
}

function isLikelyRegistryName(value: string): boolean {
  if (value.includes('\\') || value.includes(':')) {
    return false;
  }
  if (value.startsWith('@')) {
    return /^@[^@/\s]+\/[A-Za-z0-9._-]+$/.test(value);
  }
  if (value.includes('/')) {
    return false;
  }

  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

export function parseServerInput(input: string): ParsedServerInput {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Empty server input');
  }

  if (validateUrl(trimmed)) {
    return {
      kind: 'url',
      transport: inferTransport(trimmed),
      value: trimmed,
    };
  }

  const tokens = parseQuotedCommand(trimmed);
  if (tokens.length === 0) {
    throw new Error(`Invalid server input: "${input}"`);
  }

  const [commandOrName, ...args] = tokens;
  if (
    tokens.length === 1 &&
    !isQuotedCommandInput(trimmed) &&
    isLikelyRegistryName(commandOrName) &&
    !commandExists(commandOrName)
  ) {
    return { kind: 'registry', name: commandOrName };
  }

  return { kind: 'command', command: commandOrName, args };
}

export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseKeyValueList(
  values: string[],
  label: 'environment variable' | 'header',
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of values) {
    const index = entry.indexOf('=');
    if (index === -1) {
      throw new Error(`Invalid ${label} entry "${entry}". Expected KEY=VALUE.`);
    }

    const key = entry.slice(0, index).trim();
    if (!key) {
      throw new Error(`Invalid ${label} entry "${entry}". Key cannot be empty.`);
    }
    if (/\s/.test(key)) {
      throw new Error(`Invalid ${label} entry "${entry}". Key cannot contain whitespace.`);
    }
    const value = entry.slice(index + 1);
    result[key] = value;
  }
  return result;
}

export function validateEnvVars(vars: string[]): Record<string, string> {
  return parseKeyValueList(vars, 'environment variable');
}

export function validateHeaders(headers: string[]): Record<string, string> {
  return parseKeyValueList(headers, 'header');
}
