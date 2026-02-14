import { readFile } from 'node:fs/promises';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { createPatch } from 'diff';

import type {
  AgentAdapter,
  ConfigChange,
  ConfigScope,
  McpServerSpec,
} from '../types/index.js';

export type JsonPatchPath = Array<string | number>;

const COMMON_SERVER_ROOTS: JsonPatchPath[] = [
  ['mcpServers'],
  ['servers'],
  ['mcp', 'servers'],
  ['cody', 'mcpServers'],
];

const ADAPTER_ROOT_HINTS: Record<string, JsonPatchPath> = {
  cody: ['cody', 'mcpServers'],
};

const JSON_FORMAT = {
  eol: '\n',
  insertSpaces: true,
  tabSize: 2,
};

export function generateDiff(
  configPath: string,
  currentContent: string,
  newContent: string,
): string {
  if (currentContent === newContent) {
    return '';
  }

  return createPatch(
    configPath,
    currentContent,
    newContent,
    'before',
    'after',
    { context: 3, stripTrailingCr: true },
  );
}

export async function previewAdd(
  adapter: AgentAdapter,
  spec: McpServerSpec,
  scope: ConfigScope,
): Promise<ConfigChange> {
  const warnings: string[] = [];
  const configPath = await resolveConfigPath(adapter, scope);
  const before = await readConfigSource(configPath);

  if (!adapterSupportsScope(adapter, scope)) {
    warnings.push(`Scope '${scope}' is not supported by '${adapter.id}'.`);
    return makeChange(adapter, configPath, spec.name, before, before, 'add', warnings);
  }

  if (!adapterSupportsTransport(adapter, spec.transport)) {
    warnings.push(
      `Transport '${spec.transport}' is not supported by '${adapter.id}'.`,
    );
    return makeChange(adapter, configPath, spec.name, before, before, 'add', warnings);
  }

  const existingServers = await readExistingServers(adapter, scope);
  if (Object.prototype.hasOwnProperty.call(existingServers, spec.name)) {
    warnings.push(`Server '${spec.name}' already exists; no changes will be made.`);
    return makeChange(adapter, configPath, spec.name, before, before, 'add', warnings);
  }

  const rootPath = inferServerRootPath(adapter, before, existingServers);
  const transformedSpec = adapter.transformSpec(spec);
  const after = await applySetProperty(before, [...rootPath, spec.name], transformedSpec);

  if (after === before) {
    warnings.push('Unable to compute a config diff for add preview.');
  }

  if (adapter.restartRequired) {
    warnings.push('Restart may be required after applying changes.');
  }

  return makeChange(adapter, configPath, spec.name, before, after, 'add', warnings);
}

export async function previewRemove(
  adapter: AgentAdapter,
  serverName: string,
  scope: ConfigScope,
): Promise<ConfigChange> {
  const warnings: string[] = [];
  const configPath = await resolveConfigPath(adapter, scope);
  const before = await readConfigSource(configPath);

  if (!adapterSupportsScope(adapter, scope)) {
    warnings.push(`Scope '${scope}' is not supported by '${adapter.id}'.`);
    return makeChange(adapter, configPath, serverName, before, before, 'remove', warnings);
  }

  const existingServers = await readExistingServers(adapter, scope);
  if (!Object.prototype.hasOwnProperty.call(existingServers, serverName)) {
    warnings.push(`Server '${serverName}' not found for '${adapter.id}'.`);
    return makeChange(adapter, configPath, serverName, before, before, 'remove', warnings);
  }

  const rootPath = inferServerRootPath(adapter, before, existingServers);
  const after = await applyRemoveProperty(before, [...rootPath, serverName]);

  if (after === before) {
    warnings.push('Unable to compute a config diff for remove preview.');
  }

  if (adapter.restartRequired) {
    warnings.push('Restart may be required after applying changes.');
  }

  return makeChange(adapter, configPath, serverName, before, after, 'remove', warnings);
}

export async function previewChanges(
  adapters: AgentAdapter[],
  spec: McpServerSpec,
  scope: ConfigScope,
  action: 'add' | 'remove',
): Promise<ConfigChange[]> {
  const tasks = adapters.map(async (adapter) => {
    try {
      if (action === 'add') {
        return await previewAdd(adapter, spec, scope);
      }

      return await previewRemove(adapter, spec.name, scope);
    } catch (error) {
      const configPath = await resolveConfigPath(adapter, scope);
      const warning = error instanceof Error ? error.message : String(error);
      return makeChange(adapter, configPath, spec.name, '', '', action, [
        `Preview failed for '${adapter.id}': ${warning}`,
      ]);
    }
  });

  return Promise.all(tasks);
}

function makeChange(
  adapter: AgentAdapter,
  configPath: string,
  serverName: string,
  before: string,
  after: string,
  action: 'add' | 'remove',
  warnings: string[],
): ConfigChange {
  return {
    action,
    agent: adapter.id,
    before,
    after,
    configPath,
    serverName,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
  };
}

function adapterSupportsScope(adapter: AgentAdapter, scope: ConfigScope): boolean {
  if (typeof adapter.supportsScope === 'function') {
    return adapter.supportsScope(scope);
  }

  return adapter.supportedScopes.includes(scope);
}

function adapterSupportsTransport(
  adapter: AgentAdapter,
  transport: McpServerSpec['transport'],
): boolean {
  if (typeof adapter.supportsTransport === 'function') {
    return adapter.supportsTransport(transport);
  }

  return adapter.supportedTransports.includes(transport);
}

async function resolveConfigPath(adapter: AgentAdapter, scope: ConfigScope): Promise<string> {
  const paths = await Promise.resolve(adapter.getConfigPaths?.()).catch(() => []);
  const scoped = paths.filter((entry) => entry.scope === scope);
  const candidates = scoped.length > 0 ? scoped : paths;
  const chosen = candidates.find((entry) => entry.exists) ?? candidates[0];
  return chosen?.path ?? `<${adapter.id}:${scope}>`;
}

function parseJsonSource(source: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed = parse(source, errors, {
    allowEmptyContent: true,
    allowTrailingComma: true,
  });

  if (errors.length > 0 || parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  return parsed as Record<string, unknown>;
}

async function readConfigSource(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, 'utf8');
  } catch {
    return '{}';
  }
}

async function readExistingServers(
  adapter: AgentAdapter,
  scope: ConfigScope,
): Promise<Record<string, unknown>> {
  try {
    const servers = await adapter.readServers(scope);
    return servers == null || typeof servers !== 'object' ? {} : servers;
  } catch {
    return {};
  }
}

async function applySetProperty(
  source: string,
  path: JsonPatchPath,
  value: unknown,
): Promise<string> {
  try {
    const edits = modify(source, path, value, {
      formattingOptions: JSON_FORMAT,
    });

    return applyEdits(source, edits);
  } catch {
    const fallback = setByClone(parseJsonSource(source), path, value);
    return `${JSON.stringify(fallback, null, 2)}\n`;
  }
}

async function applyRemoveProperty(
  source: string,
  path: JsonPatchPath,
): Promise<string> {
  try {
    const edits = modify(source, path, undefined, {
      formattingOptions: JSON_FORMAT,
    });

    return applyEdits(source, edits);
  } catch {
    const fallback = removeByClone(parseJsonSource(source), path);
    return `${JSON.stringify(fallback, null, 2)}\n`;
  }
}

function inferServerRootPath(
  adapter: AgentAdapter,
  source: string,
  existingServers: Record<string, unknown>,
): JsonPatchPath {
  const hint = readAdapterRootHint(adapter);
  if (hint) {
    return hint;
  }

  const parsed = parseJsonSource(source);
  const existingNames = Object.keys(existingServers);

  for (const rootPath of COMMON_SERVER_ROOTS) {
    const rootNode = getValueAtPath(parsed, rootPath);
    if (!isRecord(rootNode)) {
      continue;
    }

    if (existingNames.length === 0) {
      return rootPath;
    }

    const containsKnownServer = existingNames.some((name) =>
      Object.prototype.hasOwnProperty.call(rootNode, name),
    );
    if (containsKnownServer) {
      return rootPath;
    }
  }

  return ADAPTER_ROOT_HINTS[adapter.id] ?? ['mcpServers'];
}

function readAdapterRootHint(adapter: AgentAdapter): JsonPatchPath | null {
  const candidate = adapter as unknown as {
    serverPath?: unknown;
    serverRootPath?: unknown;
    mcpServersPath?: unknown;
    getServerPath?: () => unknown;
    getServerRootPath?: () => unknown;
  };

  const candidates: unknown[] = [
    candidate.serverPath,
    candidate.serverRootPath,
    candidate.mcpServersPath,
    typeof candidate.getServerPath === 'function' ? candidate.getServerPath() : null,
    typeof candidate.getServerRootPath === 'function' ? candidate.getServerRootPath() : null,
  ];

  for (const raw of candidates) {
    const normalized = normalizeJsonPath(raw);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeJsonPath(input: unknown): JsonPatchPath | null {
  if (Array.isArray(input)) {
    const output = input.filter(
      (segment): segment is string | number =>
        typeof segment === 'string' || typeof segment === 'number',
    );
    return output.length > 0 ? output : null;
  }

  if (typeof input === 'string' && input.trim().length > 0) {
    const path = input
      .split('.')
      .map((part) => part.trim())
      .filter(Boolean);

    return path.length > 0 ? path : null;
  }

  return null;
}

function getValueAtPath(root: Record<string, unknown>, path: JsonPatchPath): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[String(segment)];
  }
  return cursor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setByClone(
  source: Record<string, unknown>,
  path: JsonPatchPath,
  value: unknown,
): Record<string, unknown> {
  const cloned = structuredClone(source) as Record<string, unknown>;
  if (path.length === 0) {
    return cloned;
  }

  let cursor = cloned as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = String(path[i]);
    const next = cursor[segment];

    if (!isRecord(next)) {
      cursor[segment] = {};
      cursor = cursor[segment] as Record<string, unknown>;
      continue;
    }

    cursor = next;
  }

  cursor[String(path[path.length - 1])] = value;
  return cloned;
}

function removeByClone(
  source: Record<string, unknown>,
  path: JsonPatchPath,
): Record<string, unknown> {
  const cloned = structuredClone(source) as Record<string, unknown>;
  if (path.length === 0) {
    return cloned;
  }

  let cursor = cloned as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = String(path[i]);
    const next = cursor[segment];

    if (!isRecord(next)) {
      return cloned;
    }

    cursor = next;
  }

  delete cursor[String(path[path.length - 1])];
  return cloned;
}
