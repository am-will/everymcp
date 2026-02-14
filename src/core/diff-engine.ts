import { readFile } from "node:fs/promises";
import { applyEdits, modify, parse } from "jsonc-parser";
import { createPatch } from "diff";

import type {
  AgentAdapter,
  ConfigChange,
  ConfigScope,
  McpServerSpec,
} from "../types/index.js";
import { removeProperty, setProperty } from "./config-manager.js";

type JsonPath = Array<string | number>;

const FORMAT_OPTIONS = {
  eol: "\n",
  insertSpaces: true,
  tabSize: 2,
};

const COMMON_SERVER_ROOTS: JsonPath[] = [
  ["mcpServers"],
  ["servers"],
  ["mcp", "servers"],
  ["cody", "mcpServers"],
];

const ADAPTER_ROOT_HINTS: Record<string, JsonPath> = {
  cody: ["cody", "mcpServers"],
};

export function generateDiff(
  configPath: string,
  currentContent: string,
  newContent: string,
): string {
  if (currentContent === newContent) {
    return "";
  }

  return createPatch(
    configPath,
    currentContent,
    newContent,
    "before",
    "after",
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
    warnings.push(
      `Scope '${scope}' is not supported by '${adapter.id}'; preview only, no changes.`,
    );
    return createChange(
      adapter.id,
      configPath,
      before,
      before,
      "add",
      spec.name,
      warnings,
    );
  }

  if (!adapterSupportsTransport(adapter, spec.transport)) {
    warnings.push(
      `Transport '${spec.transport}' is not supported by '${adapter.id}'; preview only, no changes.`,
    );
    return createChange(
      adapter.id,
      configPath,
      before,
      before,
      "add",
      spec.name,
      warnings,
    );
  }

  const existingServers = await readExistingServers(adapter, scope);
  if (Object.prototype.hasOwnProperty.call(existingServers, spec.name)) {
    warnings.push(
      `Server '${spec.name}' already exists for '${adapter.id}'; no diff.`,
    );
    return createChange(
      adapter.id,
      configPath,
      before,
      before,
      "add",
      spec.name,
      warnings,
    );
  }

  const rootPath = inferServerRootPath(adapter, before, existingServers);
  const transformedSpec = adapter.transformSpec(spec);
  const after = await applySetProperty(
    before,
    [...rootPath, spec.name],
    transformedSpec,
  );

  if (adapter.restartRequired) {
    warnings.push(
      `'${adapter.displayName ?? adapter.id}' may require restart after apply.`,
    );
  }

  return createChange(
    adapter.id,
    configPath,
    before,
    after,
    "add",
    spec.name,
    warnings,
  );
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
    warnings.push(
      `Scope '${scope}' is not supported by '${adapter.id}'; preview only, no changes.`,
    );
    return createChange(
      adapter.id,
      configPath,
      before,
      before,
      "remove",
      serverName,
      warnings,
    );
  }

  const existingServers = await readExistingServers(adapter, scope);
  if (!Object.prototype.hasOwnProperty.call(existingServers, serverName)) {
    warnings.push(
      `Server '${serverName}' was not found for '${adapter.id}'; no diff.`,
    );
    return createChange(
      adapter.id,
      configPath,
      before,
      before,
      "remove",
      serverName,
      warnings,
    );
  }

  const rootPath = inferServerRootPath(adapter, before, existingServers);
  const after = await applyRemoveProperty(before, [...rootPath, serverName]);

  if (before === after) {
    warnings.push(
      `Server '${serverName}' was found but produced no text edit for '${adapter.id}'.`,
    );
  }

  if (adapter.restartRequired) {
    warnings.push(
      `'${adapter.displayName ?? adapter.id}' may require restart after apply.`,
    );
  }

  return createChange(
    adapter.id,
    configPath,
    before,
    after,
    "remove",
    serverName,
    warnings,
  );
}

export async function previewChanges(
  adapters: AgentAdapter[],
  spec: McpServerSpec,
  scope: ConfigScope,
  action: "add" | "remove",
): Promise<ConfigChange[]> {
  const jobs = adapters.map(async (adapter) => {
    try {
      if (action === "add") {
        return await previewAdd(adapter, spec, scope);
      }

      if (!spec.name) {
        return createChange(adapter.id, "<unknown>", "{}", "{}", "remove", "", [
          "Missing server name for remove preview; no diff.",
        ]);
      }

      return await previewRemove(adapter, spec.name, scope);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createChange(
        adapter.id,
        "<unknown>",
        "{}",
        "{}",
        action,
        spec.name,
        [`Preview failed for '${adapter.id}': ${message}`],
      );
    }
  });

  return Promise.all(jobs);
}

function createChange(
  agent: string,
  configPath: string,
  before: string,
  after: string,
  action: "add" | "remove",
  serverName: string,
  warnings: string[],
): ConfigChange {
  return {
    action,
    after,
    agent,
    before,
    configPath,
    serverName,
    warning: warnings.length > 0 ? warnings.join(" ") : undefined,
  };
}

function adapterSupportsScope(
  adapter: AgentAdapter,
  scope: ConfigScope,
): boolean {
  if (typeof adapter.supportsScope === "function") {
    return adapter.supportsScope(scope);
  }

  return adapter.supportedScopes.includes(scope);
}

function adapterSupportsTransport(
  adapter: AgentAdapter,
  transport: McpServerSpec["transport"],
): boolean {
  if (typeof adapter.supportsTransport === "function") {
    return adapter.supportsTransport(transport);
  }

  return adapter.supportedTransports.includes(transport);
}

async function resolveConfigPath(
  adapter: AgentAdapter,
  scope: ConfigScope,
): Promise<string> {
  const paths = adapter.getConfigPaths();
  const scoped = paths.filter((path) => path.scope === scope);
  const candidates = scoped.length > 0 ? scoped : paths;
  const chosen = candidates.find((path) => path.exists) ?? candidates[0];
  return chosen?.path ?? `<${adapter.id}:${scope}>`;
}

async function readConfigSource(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, "utf8");
  } catch {
    return "{}";
  }
}

async function readExistingServers(
  adapter: AgentAdapter,
  scope: ConfigScope,
): Promise<Record<string, unknown>> {
  try {
    const servers = await adapter.readServers(scope);
    return servers ?? {};
  } catch {
    return {};
  }
}

async function applySetProperty(
  source: string,
  path: JsonPath,
  value: unknown,
): Promise<string> {
  try {
    return await Promise.resolve(setProperty(source, path, value));
  } catch {
    const edits = modify(source, path, value, {
      formattingOptions: FORMAT_OPTIONS,
    });
    return applyEdits(source, edits);
  }
}

async function applyRemoveProperty(
  source: string,
  path: JsonPath,
): Promise<string> {
  try {
    return await Promise.resolve(removeProperty(source, path));
  } catch {
    const edits = modify(source, path, undefined, {
      formattingOptions: FORMAT_OPTIONS,
    });
    return applyEdits(source, edits);
  }
}

function inferServerRootPath(
  adapter: AgentAdapter,
  source: string,
  existingServers: Record<string, unknown>,
): JsonPath {
  const hintedPath = readAdapterRootHint(adapter);
  if (hintedPath) {
    return hintedPath;
  }

  const parsed = parse(source) as Record<string, unknown>;
  const existingNames = Object.keys(existingServers);

  for (const rootPath of COMMON_SERVER_ROOTS) {
    const node = getValueAtPath(parsed, rootPath);
    if (!isPlainObject(node)) {
      continue;
    }

    if (existingNames.length === 0) {
      return rootPath;
    }

    const hasKnownServer = existingNames.some((name) =>
      Object.prototype.hasOwnProperty.call(node, name),
    );
    if (hasKnownServer) {
      return rootPath;
    }
  }

  return ADAPTER_ROOT_HINTS[adapter.id] ?? ["mcpServers"];
}

function readAdapterRootHint(adapter: AgentAdapter): JsonPath | null {
  const hintedAdapter = adapter as unknown as {
    serverPath?: unknown;
    serverRootPath?: unknown;
    mcpServersPath?: unknown;
    getServerPath?: () => unknown;
    getServerRootPath?: () => unknown;
  };

  const rawHints: unknown[] = [
    hintedAdapter.serverPath,
    hintedAdapter.serverRootPath,
    hintedAdapter.mcpServersPath,
    typeof hintedAdapter.getServerPath === "function"
      ? hintedAdapter.getServerPath()
      : null,
    typeof hintedAdapter.getServerRootPath === "function"
      ? hintedAdapter.getServerRootPath()
      : null,
  ];

  for (const hint of rawHints) {
    const normalized = normalizePath(hint);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizePath(input: unknown): JsonPath | null {
  if (Array.isArray(input)) {
    const cleaned = input.filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number",
    );
    return cleaned.length > 0 ? cleaned : null;
  }

  if (typeof input === "string" && input.trim().length > 0) {
    const parts = input
      .split(".")
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : null;
  }

  return null;
}

function getValueAtPath(root: unknown, path: JsonPath): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (!isPlainObject(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[String(segment)];
  }
  return cursor;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
