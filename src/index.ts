#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import type { ConfigScope, McpServerSpec, TransportType } from './types/index.js';

type UnknownRecord = Record<string, unknown>;

type JsonMap = Record<string, string>;

type MaybePromise<T> = T | Promise<T>;

type AnyFn = (...args: any[]) => MaybePromise<any>;

interface GlobalCliOptions {
  agents: string[];
  all: boolean;
  dryRun: boolean;
  force: boolean;
  name?: string;
  env: string[];
  header: string[];
  authToken?: string;
  oauthClientId?: string;
  transport?: TransportType;
  global: boolean;
  project: boolean;
  backup: boolean;
}

interface AdapterLike {
  id?: string;
  displayName?: string;
  supportedTransports?: TransportType[];
  supportedScopes?: ConfigScope[];
  restartRequired?: boolean;
  getConfigPaths?: () => MaybePromise<Array<{ scope: ConfigScope; path: string; exists: boolean }>>;
  supportsScope?: (scope: ConfigScope) => MaybePromise<boolean>;
  supportsTransport?: (transport: TransportType) => MaybePromise<boolean>;
  readServers?: (scope: ConfigScope) => MaybePromise<Record<string, unknown>>;
  addServer?: (spec: McpServerSpec, scope: ConfigScope) => MaybePromise<unknown>;
  removeServer?: (name: string, scope: ConfigScope) => MaybePromise<unknown>;
}

interface DetectedAgentLike {
  adapter: AdapterLike;
  detected: boolean;
  configPaths: Array<{ scope: ConfigScope; path: string; exists: boolean }>;
}

interface SelectedAgent extends DetectedAgentLike {
  id: string;
  displayName: string;
}

interface InteractiveLauncherResult {
  command: 'add' | 'remove' | 'list' | 'detect' | 'backup' | 'restore';
  args?: string[];
  options?: UnknownRecord;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs'] as const;

function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseAgentList(value: string, previous: string[]): string[] {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return [...previous, ...parts];
}

function parseTransport(value: string): TransportType {
  if (value === 'stdio' || value === 'http' || value === 'sse') {
    return value;
  }
  throw new InvalidArgumentError("Transport must be one of: 'stdio', 'http', 'sse'.");
}

function parseKvPairs(values: string[]): JsonMap {
  const result: JsonMap = {};
  for (const pair of values) {
    const index = pair.indexOf('=');
    if (index <= 0) {
      throw new InvalidArgumentError(`Invalid KEY=VALUE pair: "${pair}"`);
    }
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!key) {
      throw new InvalidArgumentError(`Invalid KEY=VALUE pair: "${pair}"`);
    }
    result[key] = value;
  }
  return result;
}

function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }
  return tokens;
}

function sanitizeName(candidate: string): string {
  const normalized = candidate
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'mcp-server';
}

function inferServerName(serverInput: string): string {
  try {
    const parsed = new URL(serverInput);
    return sanitizeName(parsed.hostname || parsed.pathname || 'mcp-server');
  } catch {
    const [first] = tokenizeCommand(serverInput);
    if (!first) {
      return 'mcp-server';
    }
    return sanitizeName(path.basename(first));
  }
}

function normalizeCliOptions(raw: UnknownRecord): GlobalCliOptions {
  return {
    agents: Array.isArray(raw.agents) ? (raw.agents as string[]) : [],
    all: Boolean(raw.all),
    dryRun: Boolean(raw.dryRun),
    force: Boolean(raw.force),
    name: typeof raw.name === 'string' ? raw.name : undefined,
    env: Array.isArray(raw.env) ? (raw.env as string[]) : [],
    header: Array.isArray(raw.header) ? (raw.header as string[]) : [],
    authToken: typeof raw.authToken === 'string' ? raw.authToken : undefined,
    oauthClientId: typeof raw.oauthClientId === 'string' ? raw.oauthClientId : undefined,
    transport: raw.transport as TransportType | undefined,
    global: Boolean(raw.global),
    project: Boolean(raw.project),
    backup: raw.backup !== false
  };
}

function resolveScope(options: GlobalCliOptions): ConfigScope {
  if (options.global && options.project) {
    throw new InvalidArgumentError("Flags '--global' and '--project' are mutually exclusive.");
  }
  return options.project ? 'project' : 'global';
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadLocalModule(moduleStem: string): Promise<UnknownRecord | null> {
  for (const extension of MODULE_EXTENSIONS) {
    const candidate = path.join(MODULE_DIR, `${moduleStem}${extension}`);
    if (!(await fileExists(candidate))) {
      continue;
    }
    try {
      const imported = (await import(pathToFileURL(candidate).href)) as UnknownRecord;
      return imported;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Warning: failed to load ${moduleStem}${extension}: ${message}`);
    }
  }
  return null;
}

function resolveFunction(moduleValue: unknown, names: string[]): AnyFn | null {
  if (!moduleValue || typeof moduleValue !== 'object') {
    return null;
  }

  const objectValue = moduleValue as UnknownRecord;
  for (const name of names) {
    const candidate = objectValue[name];
    if (typeof candidate === 'function') {
      return candidate as AnyFn;
    }
  }

  if (objectValue.default && typeof objectValue.default === 'object') {
    const nested = resolveFunction(objectValue.default, names);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function normalizeDetectedAgents(raw: unknown): SelectedAgent[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: SelectedAgent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const detected = item as UnknownRecord;
    const adapterCandidate = (detected.adapter ?? detected) as AdapterLike;
    const id = typeof adapterCandidate.id === 'string' ? adapterCandidate.id : '';
    if (!id) {
      continue;
    }

    const displayName =
      typeof adapterCandidate.displayName === 'string' ? adapterCandidate.displayName : adapterCandidate.id ?? 'unknown';
    const configPaths = Array.isArray(detected.configPaths) ? (detected.configPaths as SelectedAgent['configPaths']) : [];
    const detectedFlag = 'detected' in detected ? Boolean(detected.detected) : true;

    normalized.push({
      adapter: adapterCandidate,
      id,
      displayName,
      detected: detectedFlag,
      configPaths
    });
  }
  return normalized;
}

async function loadDetectedAgents(): Promise<SelectedAgent[]> {
  const registryModule = await loadLocalModule('agents/registry');
  if (!registryModule) {
    return [];
  }

  const detectAll = resolveFunction(registryModule, ['detectAll']);
  if (detectAll) {
    return normalizeDetectedAgents(await detectAll());
  }

  const getDetectedAdapters = resolveFunction(registryModule, ['getDetectedAdapters']);
  if (getDetectedAdapters) {
    return normalizeDetectedAgents(await getDetectedAdapters());
  }

  const getAllAdapters = resolveFunction(registryModule, ['getAllAdapters']);
  if (getAllAdapters) {
    const adapters = normalizeDetectedAgents(await getAllAdapters());
    return adapters.map((agent) => ({ ...agent, detected: true }));
  }

  return [];
}

async function supportsScope(agent: SelectedAgent, scope: ConfigScope): Promise<boolean> {
  if (typeof agent.adapter.supportsScope === 'function') {
    return Boolean(await agent.adapter.supportsScope(scope));
  }
  if (Array.isArray(agent.adapter.supportedScopes)) {
    return agent.adapter.supportedScopes.includes(scope);
  }
  return true;
}

async function supportsTransport(agent: SelectedAgent, transport: TransportType): Promise<boolean> {
  if (typeof agent.adapter.supportsTransport === 'function') {
    return Boolean(await agent.adapter.supportsTransport(transport));
  }
  if (Array.isArray(agent.adapter.supportedTransports)) {
    return agent.adapter.supportedTransports.includes(transport);
  }
  return true;
}

function pickByIds(agents: SelectedAgent[], ids: string[]): SelectedAgent[] {
  if (ids.length === 0) {
    return agents;
  }

  const requested = new Set(ids.map((id) => id.toLowerCase()));
  return agents.filter((agent) => requested.has(agent.id.toLowerCase()));
}

async function runWizardSelection(
  candidates: SelectedAgent[],
  scope: ConfigScope,
  transport: TransportType
): Promise<SelectedAgent[]> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return candidates;
  }

  const appModule = await loadLocalModule('cli/app');
  if (!appModule) {
    return candidates;
  }

  const launchWizard = resolveFunction(appModule, ['runWizard', 'selectAgents', 'launchWizard', 'promptAgentSelection']);
  if (!launchWizard) {
    return candidates;
  }

  const selected = await launchWizard(candidates, scope, transport);
  if (!Array.isArray(selected)) {
    return candidates;
  }

  if (selected.length === 0) {
    return [];
  }

  if (typeof selected[0] === 'string') {
    return pickByIds(candidates, selected as string[]);
  }

  return normalizeDetectedAgents(selected as unknown);
}

async function parseSpecLocally(serverInput: string, options: GlobalCliOptions): Promise<McpServerSpec> {
  const env = options.env.length > 0 ? parseKvPairs(options.env) : undefined;
  const headers = options.header.length > 0 ? parseKvPairs(options.header) : undefined;
  const mergedHeaders: JsonMap = { ...(headers ?? {}) };

  if (options.authToken) {
    mergedHeaders.Authorization = `Bearer ${options.authToken}`;
  }

  let transport = options.transport;
  let spec: McpServerSpec;

  try {
    const parsedUrl = new URL(serverInput);
    if (!transport) {
      transport = parsedUrl.protocol.startsWith('http') ? 'http' : 'sse';
    }
    spec = {
      name: options.name ?? inferServerName(serverInput),
      transport: transport ?? 'http',
      url: serverInput,
      headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
      env
    };
  } catch {
    const parts = tokenizeCommand(serverInput);
    if (parts.length === 0) {
      throw new InvalidArgumentError(`Invalid server spec: "${serverInput}"`);
    }
    spec = {
      name: options.name ?? inferServerName(serverInput),
      transport: transport ?? 'stdio',
      command: parts[0],
      args: parts.slice(1),
      headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
      env
    };
  }

  if (options.oauthClientId) {
    spec.oauth = { clientId: options.oauthClientId };
  }

  return spec;
}

async function parseSpec(serverInput: string, options: GlobalCliOptions): Promise<McpServerSpec> {
  const parserModule = await loadLocalModule('core/server-spec');
  if (!parserModule) {
    return parseSpecLocally(serverInput, options);
  }

  const parseServerSpec = resolveFunction(parserModule, ['parseServerSpec', 'parseServerInput', 'parseSpec']);
  if (!parseServerSpec) {
    return parseSpecLocally(serverInput, options);
  }

  try {
    const parsed = await parseServerSpec(serverInput, options);
    if (parsed && typeof parsed === 'object' && typeof (parsed as McpServerSpec).name === 'string') {
      return parsed as McpServerSpec;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Warning: parser module failed, falling back to local parser: ${message}`);
  }

  return parseSpecLocally(serverInput, options);
}

async function createBackupIfAvailable(agent: SelectedAgent, scope: ConfigScope): Promise<void> {
  const backupModule = await loadLocalModule('core/backup-manager');
  if (!backupModule) {
    return;
  }

  const createBackup = resolveFunction(backupModule, ['createBackup']);
  if (!createBackup) {
    return;
  }

  const configPaths =
    typeof agent.adapter.getConfigPaths === 'function' ? await agent.adapter.getConfigPaths() : agent.configPaths;
  for (const entry of configPaths) {
    if (entry.scope === scope) {
      await createBackup(agent.id, entry.path);
    }
  }
}

async function previewIfAvailable(
  adapters: SelectedAgent[],
  spec: McpServerSpec,
  scope: ConfigScope,
  action: 'add' | 'remove'
): Promise<unknown[] | null> {
  const diffModule = await loadLocalModule('core/diff-engine');
  if (!diffModule) {
    return null;
  }

  const previewChanges = resolveFunction(diffModule, ['previewChanges']);
  if (!previewChanges) {
    return null;
  }

  const raw = await previewChanges(
    adapters.map((agent) => agent.adapter),
    spec,
    scope,
    action
  );

  if (!Array.isArray(raw)) {
    return null;
  }

  return raw;
}

function printSimpleChanges(changes: unknown[]): void {
  if (changes.length === 0) {
    console.log('No changes.');
    return;
  }

  for (const change of changes) {
    if (!change || typeof change !== 'object') {
      continue;
    }
    const item = change as UnknownRecord;
    const agent = typeof item.agent === 'string' ? item.agent : 'unknown-agent';
    const action = typeof item.action === 'string' ? item.action : 'change';
    const server = typeof item.serverName === 'string' ? item.serverName : '';
    const warning = typeof item.warning === 'string' ? ` [warning: ${item.warning}]` : '';
    console.log(`- ${agent}: ${action} ${server}${warning}`);
  }
}

function printDetectedAgents(agents: SelectedAgent[]): void {
  if (agents.length === 0) {
    console.log('No detected agents.');
    return;
  }

  for (const agent of agents) {
    const transports = Array.isArray(agent.adapter.supportedTransports)
      ? agent.adapter.supportedTransports.join(',')
      : 'unknown';
    const scopes = Array.isArray(agent.adapter.supportedScopes) ? agent.adapter.supportedScopes.join(',') : 'unknown';
    const configPaths = agent.configPaths.map((entry) => `${entry.scope}:${entry.path}`).join(' | ') || 'n/a';
    console.log(`${agent.id} (${agent.displayName})`);
    console.log(`  detected=${agent.detected} transports=${transports} scopes=${scopes}`);
    console.log(`  configs=${configPaths}`);
  }
}

async function confirmOverwrite(agentName: string, serverName: string): Promise<boolean> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return false;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await rl.question(`Server "${serverName}" exists in ${agentName}. Overwrite? [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function selectTargetAgents(
  detectedAgents: SelectedAgent[],
  options: GlobalCliOptions,
  scope: ConfigScope,
  transport: TransportType
): Promise<SelectedAgent[]> {
  const detectedOnly = detectedAgents.filter((agent) => agent.detected);
  const explicit = pickByIds(detectedOnly, options.agents);
  if (options.agents.length > 0) {
    return explicit;
  }
  if (options.all) {
    return detectedOnly;
  }
  return runWizardSelection(detectedOnly, scope, transport);
}

async function filterCompatibleAgents(
  agents: SelectedAgent[],
  scope: ConfigScope,
  transport?: TransportType
): Promise<{ compatible: SelectedAgent[]; skipped: string[] }> {
  const compatible: SelectedAgent[] = [];
  const skipped: string[] = [];

  for (const agent of agents) {
    const scopeOk = await supportsScope(agent, scope);
    if (!scopeOk) {
      skipped.push(`${agent.id} (scope "${scope}" not supported)`);
      continue;
    }

    if (transport) {
      const transportOk = await supportsTransport(agent, transport);
      if (!transportOk) {
        skipped.push(`${agent.id} (transport "${transport}" not supported)`);
        continue;
      }
    }

    compatible.push(agent);
  }

  return { compatible, skipped };
}

function readVersion(): string {
  try {
    const packageJsonPath = path.resolve(MODULE_DIR, '..', 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    if (packageJson.version) {
      return packageJson.version;
    }
  } catch {
    return '0.0.0-dev';
  }
  return '0.0.0-dev';
}

async function handleAdd(serverInput: string, rawOptions: UnknownRecord): Promise<void> {
  const options = normalizeCliOptions(rawOptions);
  const scope = resolveScope(options);
  const spec = await parseSpec(serverInput, options);
  const detected = await loadDetectedAgents();
  const selected = await selectTargetAgents(detected, options, scope, spec.transport);
  const { compatible, skipped } = await filterCompatibleAgents(selected, scope, spec.transport);

  if (skipped.length > 0) {
    console.log(`Skipped: ${skipped.join(', ')}`);
  }
  if (compatible.length === 0) {
    console.log('No compatible agents selected.');
    return;
  }

  if (options.dryRun) {
    const preview = await previewIfAvailable(compatible, spec, scope, 'add');
    if (preview) {
      printSimpleChanges(preview);
    } else {
      printSimpleChanges(
        compatible.map((agent) => ({
          agent: agent.id,
          action: 'add',
          serverName: spec.name,
          warning: 'diff engine unavailable'
        }))
      );
    }
    return;
  }

  const results: unknown[] = [];
  for (const agent of compatible) {
    const existing =
      typeof agent.adapter.readServers === 'function'
        ? await Promise.resolve(agent.adapter.readServers(scope)).catch(
            () => ({} as Record<string, unknown>)
          )
        : {};
    const exists =
      existing && typeof existing === 'object' && Object.prototype.hasOwnProperty.call(existing, spec.name);

    if (exists && !options.force) {
      const confirmed = await confirmOverwrite(agent.displayName, spec.name);
      if (!confirmed) {
        results.push({
          agent: agent.id,
          action: 'add',
          serverName: spec.name,
          warning: 'name collision (skipped)'
        });
        continue;
      }
    }

    if (options.backup) {
      await createBackupIfAvailable(agent, scope);
    }

    if (typeof agent.adapter.addServer !== 'function') {
      results.push({
        agent: agent.id,
        action: 'add',
        serverName: spec.name,
        warning: 'adapter addServer() unavailable'
      });
      continue;
    }

    try {
      const response = await agent.adapter.addServer(spec, scope);
      results.push(
        response ?? {
          agent: agent.id,
          action: 'add',
          serverName: spec.name
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        agent: agent.id,
        action: 'add',
        serverName: spec.name,
        warning: message
      });
    }
  }

  printSimpleChanges(results);
  const restartRequired = compatible
    .filter((agent) => agent.adapter.restartRequired)
    .map((agent) => agent.displayName);
  if (restartRequired.length > 0) {
    console.log(`Restart required: ${restartRequired.join(', ')}`);
  }
}

async function handleRemove(serverName: string, rawOptions: UnknownRecord): Promise<void> {
  const options = normalizeCliOptions(rawOptions);
  const scope = resolveScope(options);
  const detected = await loadDetectedAgents();
  const selected = await selectTargetAgents(detected, options, scope, options.transport ?? 'stdio');
  const { compatible, skipped } = await filterCompatibleAgents(selected, scope, options.transport);

  if (skipped.length > 0) {
    console.log(`Skipped: ${skipped.join(', ')}`);
  }
  if (compatible.length === 0) {
    console.log('No compatible agents selected.');
    return;
  }

  if (options.dryRun) {
    const syntheticSpec: McpServerSpec = {
      name: serverName,
      transport: options.transport ?? 'stdio'
    };
    const preview = await previewIfAvailable(compatible, syntheticSpec, scope, 'remove');
    if (preview) {
      printSimpleChanges(preview);
    } else {
      printSimpleChanges(
        compatible.map((agent) => ({
          agent: agent.id,
          action: 'remove',
          serverName,
          warning: 'diff engine unavailable'
        }))
      );
    }
    return;
  }

  const results: unknown[] = [];
  for (const agent of compatible) {
    if (options.backup) {
      await createBackupIfAvailable(agent, scope);
    }

    if (typeof agent.adapter.removeServer !== 'function') {
      results.push({
        agent: agent.id,
        action: 'remove',
        serverName,
        warning: 'adapter removeServer() unavailable'
      });
      continue;
    }

    try {
      const response = await agent.adapter.removeServer(serverName, scope);
      results.push(
        response ?? {
          agent: agent.id,
          action: 'remove',
          serverName
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        agent: agent.id,
        action: 'remove',
        serverName,
        warning: message
      });
    }
  }

  printSimpleChanges(results);
}

async function handleList(rawOptions: UnknownRecord): Promise<void> {
  const options = normalizeCliOptions(rawOptions);
  const scope = resolveScope(options);
  const detected = await loadDetectedAgents();
  const selected = options.agents.length > 0 ? pickByIds(detected, options.agents) : detected;

  if (selected.length === 0) {
    console.log('No matching agents found.');
    return;
  }

  const lines: string[] = [];
  for (const agent of selected) {
    if (typeof agent.adapter.readServers !== 'function') {
      continue;
    }

    const servers = await Promise.resolve(agent.adapter.readServers(scope)).catch(
      () => ({} as Record<string, unknown>)
    );
    for (const [name, value] of Object.entries(servers ?? {})) {
      const entry = value as UnknownRecord;
      const transport = typeof entry.type === 'string' ? entry.type : typeof entry.url === 'string' ? 'http' : 'stdio';
      const endpoint = typeof entry.url === 'string' ? entry.url : typeof entry.command === 'string' ? entry.command : '';
      lines.push(`${agent.id}\t${name}\t${transport}\t${endpoint}`);
    }
  }

  if (lines.length === 0) {
    console.log('No MCP servers found.');
    return;
  }

  console.log('agent\tname\ttransport\tendpoint');
  for (const line of lines) {
    console.log(line);
  }
}

async function handleDetect(): Promise<void> {
  const detected = await loadDetectedAgents();
  printDetectedAgents(detected);
}

async function handleBackup(rawOptions: UnknownRecord): Promise<void> {
  const options = normalizeCliOptions(rawOptions);
  const detected = await loadDetectedAgents();
  const selected = options.agents.length > 0 ? pickByIds(detected, options.agents) : detected;

  if (selected.length === 0) {
    console.log('No matching agents found.');
    return;
  }

  for (const agent of selected) {
    const scopes = typeof agent.adapter.getConfigPaths === 'function' ? await agent.adapter.getConfigPaths() : agent.configPaths;
    for (const entry of scopes) {
      const backupModule = await loadLocalModule('core/backup-manager');
      const createBackup = resolveFunction(backupModule, ['createBackup']);
      if (!createBackup) {
        console.log(`${agent.id}: backup manager unavailable.`);
        continue;
      }
      await createBackup(agent.id, entry.path);
      console.log(`${agent.id}: backed up ${entry.path}`);
    }
  }
}

async function handleRestore(rawOptions: UnknownRecord): Promise<void> {
  const options = normalizeCliOptions(rawOptions);
  const backupModule = await loadLocalModule('core/backup-manager');
  const listBackups = resolveFunction(backupModule, ['listBackups']);
  const restoreBackup = resolveFunction(backupModule, ['restoreBackup']);

  if (!listBackups || !restoreBackup) {
    console.log('Backup manager restore/list functions are unavailable.');
    return;
  }

  const backups = await listBackups();
  if (!Array.isArray(backups) || backups.length === 0) {
    console.log('No backups found.');
    return;
  }

  const filtered = options.agents.length
    ? backups.filter((entry) => entry && typeof entry === 'object' && options.agents.includes(String((entry as UnknownRecord).agent)))
    : backups;

  if (filtered.length === 0) {
    console.log('No matching backups.');
    return;
  }

  let selected: unknown;
  const latest = rawOptions.latest === true;
  if (latest) {
    selected = filtered[0];
  } else if (process.stdout.isTTY && process.stdin.isTTY) {
    console.log('Available backups:');
    filtered.forEach((entry, idx) => {
      const item = entry as UnknownRecord;
      console.log(
        `${idx + 1}. ${String(item.agent ?? 'unknown')} ${String(item.configPath ?? '')} ${String(item.timestamp ?? '')}`
      );
    });
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Select backup number: ');
    rl.close();
    const index = Number(answer) - 1;
    selected = filtered[index];
  } else {
    selected = filtered[0];
    console.log('Non-interactive mode: restoring first backup (use --latest to silence).');
  }

  if (!selected) {
    throw new InvalidArgumentError('No backup selected.');
  }

  await restoreBackup(selected);
  const item = selected as UnknownRecord;
  console.log(`Restored backup for ${String(item.agent ?? 'unknown')} at ${String(item.configPath ?? '')}`);
}

function normalizeInteractiveResult(raw: unknown): InteractiveLauncherResult | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as UnknownRecord;
  const command = value.command;
  if (
    command !== 'add' &&
    command !== 'remove' &&
    command !== 'list' &&
    command !== 'detect' &&
    command !== 'backup' &&
    command !== 'restore'
  ) {
    return null;
  }

  const args = Array.isArray(value.args) ? value.args.map((item) => String(item)) : undefined;
  const options = value.options && typeof value.options === 'object' ? (value.options as UnknownRecord) : undefined;

  return {
    command,
    args,
    options
  };
}

async function runInteractiveWizard(rawOptions: UnknownRecord): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log('Interactive wizard requires a TTY. Use commands like `everymcp add ...` in non-interactive mode.');
    return;
  }

  const launcherModule = await loadLocalModule('cli/launcher');
  const runLauncher = resolveFunction(launcherModule, ['runInteractiveLauncher', 'runLauncher']);
  if (!runLauncher) {
    console.log('Interactive wizard is unavailable.');
    return;
  }

  const selection = normalizeInteractiveResult(await runLauncher(rawOptions));
  if (!selection) {
    return;
  }

  const mergedOptions: UnknownRecord = {
    ...rawOptions,
    ...(selection.options ?? {})
  };

  switch (selection.command) {
    case 'add': {
      const [serverSpec] = selection.args ?? [];
      if (!serverSpec) {
        throw new InvalidArgumentError('Wizard did not provide a server spec.');
      }
      await handleAdd(serverSpec, mergedOptions);
      return;
    }
    case 'remove': {
      const [serverName] = selection.args ?? [];
      if (!serverName) {
        throw new InvalidArgumentError('Wizard did not provide a server name.');
      }
      await handleRemove(serverName, mergedOptions);
      return;
    }
    case 'list':
      await handleList(mergedOptions);
      return;
    case 'detect':
      await handleDetect();
      return;
    case 'backup':
      await handleBackup(mergedOptions);
      return;
    case 'restore':
      await handleRestore(mergedOptions);
      return;
    default:
      return;
  }
}

function buildProgram(): Command {
  const program = new Command();

  program
    .name('everymcp')
    .description('Universal MCP Server Installer')
    .version(readVersion())
    .showHelpAfterError();

  program
    .option('--agents <list>', 'comma-separated agent ids', parseAgentList, [])
    .option('--all', 'target all detected agents')
    .option('--dry-run', 'preview changes without writing files')
    .option('--force', 'overwrite existing server entries without prompting')
    .option('--name <name>', 'override server name')
    .option('-e, --env <pair>', 'set env var KEY=VALUE (repeatable)', collectRepeatable, [])
    .option('--header <pair>', 'set HTTP header KEY=VALUE (repeatable)', collectRepeatable, [])
    .option('--auth-token <token>', 'set bearer token and add Authorization header')
    .option('--oauth-client-id <id>', 'set OAuth client ID')
    .option('--transport <type>', 'force transport type', parseTransport)
    .option('--global', 'use global config scope (default)')
    .option('--project', 'use project-level config scope')
    .option('--no-backup', 'skip config backups');

  program
    .command('wizard', { isDefault: true })
    .description('Open interactive TUI wizard')
    .action(async function action() {
      await runInteractiveWizard(this.optsWithGlobals() as UnknownRecord);
    });

  program
    .command('add')
    .description('Add MCP server to selected agents')
    .argument('<server-spec>', 'server URL or command')
    .action(async function action(serverSpec: string) {
      await handleAdd(serverSpec, this.optsWithGlobals() as UnknownRecord);
    });

  program
    .command('remove')
    .description('Remove MCP server from selected agents')
    .argument('<server-name>', 'server name to remove')
    .action(async function action(serverName: string) {
      await handleRemove(serverName, this.optsWithGlobals() as UnknownRecord);
    });

  program
    .command('list')
    .description('List MCP servers across detected agents')
    .action(async function action() {
      await handleList(this.optsWithGlobals() as UnknownRecord);
    });

  program
    .command('detect')
    .description('Detect installed agents and show capability matrix')
    .action(async () => {
      await handleDetect();
    });

  program
    .command('backup')
    .description('Create backups for detected agent configs')
    .action(async function action() {
      await handleBackup(this.optsWithGlobals() as UnknownRecord);
    });

  program
    .command('restore')
    .description('Restore configs from backups')
    .option('--latest', 'restore the most recent backup')
    .action(async function action() {
      const merged = {
        ...(this.optsWithGlobals() as UnknownRecord),
        ...(this.opts() as UnknownRecord)
      };
      await handleRestore(merged);
    });

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
