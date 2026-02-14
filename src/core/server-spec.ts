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

export interface ServerSpecOverrides {
  name?: string;
  env?: string[];
  header?: string[];
  headers?: string[];
  authToken?: string;
  oauthClientId?: string;
  transport?: TransportType;
}

function normalizeTransport(value?: string): TransportType | undefined {
  if (!value) {
    return undefined;
  }
  if (value === 'stdio' || value === 'http' || value === 'sse') {
    return value;
  }
  throw new Error(`Invalid transport override: ${value}`);
}

function splitCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let tokenStarted = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];

    if (char === '\\' && quote !== "'") {
      const next = input[index + 1];
      if (next !== undefined) {
        current += next;
        tokenStarted = true;
        index += 1;
        continue;
      }
      continue;
    }

    if (quote === null && (char === '"' || char === "'")) {
      quote = char;
      tokenStarted = true;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (quote === null && /\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (tokenStarted) {
    tokens.push(current);
  }

  return tokens;
}

function detectUrlTransport(url: URL): TransportType {
  if (url.searchParams.get('transport')?.toLowerCase() === 'sse') {
    return 'sse';
  }
  const path = url.pathname.toLowerCase();
  if (path.endsWith('/sse') || path.includes('/sse/')) {
    return 'sse';
  }
  return 'http';
}

function parseNameFromUrl(url: URL): string {
  if (url.hostname) {
    return (
      url.hostname
        .replace(/\./g, '-')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .toLowerCase() || 'mcp-server'
    );
  }
  return 'mcp-server';
}

function parseNameFromCommand(command: string): string {
  const segments = command.split(/[\\/]/);
  const base = segments[segments.length - 1] || command;
  const noExt = base.endsWith('.cmd') ? base.slice(0, -4) : base;
  return (
    noExt
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'mcp-server'
  );
}

function parsePairs(input: string[] | undefined, kind: 'env' | 'header'): Record<string, string> {
  const result: Record<string, string> = {};
  if (!input) {
    return result;
  }

  for (const raw of input) {
    const separator = raw.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Invalid ${kind} pair: ${raw}`);
    }
    const key = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1);
    if (!key) {
      throw new Error(`Invalid ${kind} pair: ${raw}`);
    }
    result[key] = value;
  }

  return result;
}

function parseUrlSpec(input: string): McpServerSpec {
  const url = new URL(input);
  return {
    name: parseNameFromUrl(url),
    transport: detectUrlTransport(url),
    url: url.href,
  };
}

function parseCommandSpec(input: string): McpServerSpec {
  const tokens = splitCommandLine(input);
  if (tokens.length === 0) {
    throw new Error(`Invalid command spec: ${input}`);
  }

  return {
    name: parseNameFromCommand(tokens[0]),
    transport: 'stdio',
    command: tokens[0],
    args: tokens.slice(1),
  };
}

function isLikelyUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

function applyOverrides(spec: McpServerSpec, overrides: ServerSpecOverrides | undefined): McpServerSpec {
  if (!overrides || Object.keys(overrides).length === 0) {
    return spec;
  }

  const next: McpServerSpec = { ...spec };

  if (overrides.name) {
    next.name = overrides.name;
  }

  if (overrides.env?.length) {
    next.env = {
      ...(next.env ?? {}),
      ...parsePairs(overrides.env, 'env'),
    };
  }

  const headerFromFlag = parsePairs(overrides.header, 'header');
  const headersFromList = parsePairs(overrides.headers, 'header');
  if (Object.keys(headerFromFlag).length) {
    next.headers = {
      ...(next.headers ?? {}),
      ...headerFromFlag,
      ...headersFromList,
    };
  } else if (Object.keys(headersFromList).length) {
    next.headers = {
      ...(next.headers ?? {}),
      ...headersFromList,
    };
  }

  if (overrides.authToken) {
    next.headers = {
      ...(next.headers ?? {}),
      Authorization: `Bearer ${overrides.authToken}`,
    };
  }

  if (overrides.oauthClientId) {
    next.oauth = {
      ...(next.oauth ?? {}),
      clientId: overrides.oauthClientId,
    };
  }

  const transport = normalizeTransport(overrides.transport);
  if (transport && transport !== spec.transport) {
    if ((spec.transport === 'stdio' && transport !== 'stdio') || (spec.transport !== 'stdio' && transport === 'stdio')) {
      throw new Error(`Cannot override transport ${spec.transport} to ${transport} with this input form`);
    }
    next.transport = transport;
  }

  return next;
}

export function parseServerInput(input: string, overrides?: ServerSpecOverrides): McpServerSpec {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Server spec input is empty');
  }

  const unquotedInput = trimmed.replace(/^\s*(["'])(.*)\1\s*$/, '$2');
  const base = isLikelyUrl(unquotedInput) ? parseUrlSpec(unquotedInput) : parseCommandSpec(unquotedInput);

  return applyOverrides(base, overrides);
}

export function parseServerSpec(input: string, overrides?: ServerSpecOverrides): McpServerSpec {
  return parseServerInput(input, overrides);
}

export { splitCommandLine as splitCommandSpecArgs };
