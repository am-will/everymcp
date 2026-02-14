import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { parse, type ParseError } from 'jsonc-parser';
import * as configManager from '../core/config-manager.js';
import * as platform from '../utils/platform.js';
import type {
  AgentAdapter,
  ConfigChange,
  ConfigPathInfo,
  ConfigScope,
  McpServerSpec,
  TransportType,
} from '../types/index.js';

type JsonPath = Array<string | number>;

interface ConfigManagerLike {
  deepMergeServer?: (
    source: string,
    rootKey: string,
    serverName: string,
    serverConfig: Record<string, unknown>,
  ) => Promise<string> | string;
  readConfig?: (path: string) => Promise<unknown> | unknown;
  removeProperty?: (source: string, path: JsonPath) => Promise<string> | string;
  setProperty?: (
    source: string,
    path: JsonPath,
    value: unknown,
  ) => Promise<string> | string;
  writeConfig?: (
    path: string,
    data: unknown,
    originalSource?: string,
  ) => Promise<void> | void;
}

interface PlatformLike {
  commandExists?: (command: string) => Promise<boolean> | boolean;
  directoryExists?: (dir: string) => Promise<boolean> | boolean;
  fileExists?: (file: string) => Promise<boolean> | boolean;
  getPlatform?: () => 'macos' | 'linux' | 'windows';
  resolveConfigPath?: (template: string) => string;
}

const manager = configManager as ConfigManagerLike;
const platformUtils = platform as PlatformLike;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export abstract class BaseAdapter implements AgentAdapter {
  abstract id: string;
  abstract displayName: string;
  abstract supportedTransports: TransportType[];
  abstract supportedScopes: ConfigScope[];
  abstract restartRequired: boolean;
  abstract getConfigPaths(): ConfigPathInfo[];
  abstract transformSpec(spec: McpServerSpec): Record<string, unknown>;

  protected rootKey = 'mcpServers';

  protected getRootPath(_scope: ConfigScope): JsonPath {
    return [this.rootKey];
  }

  protected getConfigPathForScope(scope: ConfigScope): ConfigPathInfo | undefined {
    return this.getConfigPaths().find((entry) => entry.scope === scope);
  }

  protected async commandExists(command: string): Promise<boolean> {
    if (typeof platformUtils.commandExists === 'function') {
      return Boolean(await platformUtils.commandExists(command));
    }

    return false;
  }

  protected async directoryExists(path: string): Promise<boolean> {
    if (typeof platformUtils.directoryExists === 'function') {
      return Boolean(await platformUtils.directoryExists(path));
    }

    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  }

  protected async fileExists(path: string): Promise<boolean> {
    if (typeof platformUtils.fileExists === 'function') {
      return Boolean(await platformUtils.fileExists(path));
    }

    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  }

  protected getPlatform(): 'macos' | 'linux' | 'windows' {
    if (typeof platformUtils.getPlatform === 'function') {
      return platformUtils.getPlatform();
    }

    if (process.platform === 'darwin') {
      return 'macos';
    }
    if (process.platform === 'win32') {
      return 'windows';
    }
    return 'linux';
  }

  protected resolvePath(template: string): string {
    if (typeof platformUtils.resolveConfigPath === 'function') {
      return platformUtils.resolveConfigPath(template);
    }

    const home = homedir();
    return template
      .replace(/^~(?=$|\/|\\)/, home)
      .replace(/%APPDATA%/g, process.env.APPDATA ?? '')
      .replace(/%USERPROFILE%/g, process.env.USERPROFILE ?? home);
  }

  protected toBaseServerConfig(spec: McpServerSpec): Record<string, unknown> {
    const config: Record<string, unknown> = {};

    if (spec.command) {
      config.command = spec.command;
    }
    if (spec.args && spec.args.length > 0) {
      config.args = [...spec.args];
    }
    if (spec.url) {
      config.url = spec.url;
    }
    if (spec.headers && Object.keys(spec.headers).length > 0) {
      config.headers = { ...spec.headers };
    }
    if (spec.env && Object.keys(spec.env).length > 0) {
      config.env = { ...spec.env };
    }
    if (spec.oauth) {
      config.oauth = { ...spec.oauth };
    }
    if (typeof spec.disabled === 'boolean') {
      config.disabled = spec.disabled;
    }

    return config;
  }

  supportsScope(scope: ConfigScope): boolean {
    return this.supportedScopes.includes(scope);
  }

  supportsTransport(transport: TransportType): boolean {
    return this.supportedTransports.includes(transport);
  }

  async detect(): Promise<boolean> {
    try {
      const paths = this.getConfigPaths();
      return paths.some((pathInfo) => pathInfo.exists);
    } catch {
      return false;
    }
  }

  async readServers(scope: ConfigScope): Promise<Record<string, unknown>> {
    if (!this.supportsScope(scope)) {
      return {};
    }

    const pathInfo = this.getConfigPathForScope(scope);
    if (!pathInfo) {
      return {};
    }

    const data = await this.readConfigObject(pathInfo.path);
    const root = this.getFromPath(data, this.getRootPath(scope));
    return isRecord(root) ? root : {};
  }

  async addServer(spec: McpServerSpec, scope: ConfigScope): Promise<ConfigChange> {
    const pathInfo = this.getConfigPathForScope(scope);
    const configPath = pathInfo?.path ?? '';
    const before = configPath ? await this.readConfigSource(configPath) : '{}\n';
    const warnings: string[] = [];

    if (!this.supportsScope(scope)) {
      warnings.push(
        `Scope "${scope}" is not supported by ${this.displayName}. Supported scopes: ${this.supportedScopes.join(', ')}`,
      );
      return this.buildChange('add', spec.name, configPath, before, before, warnings);
    }

    if (!this.supportsTransport(spec.transport)) {
      warnings.push(
        `Transport "${spec.transport}" is not supported by ${this.displayName}. Supported transports: ${this.supportedTransports.join(', ')}`,
      );
      return this.buildChange('add', spec.name, configPath, before, before, warnings);
    }

    if (!pathInfo) {
      warnings.push(`No config path is available for scope "${scope}" in ${this.displayName}.`);
      return this.buildChange('add', spec.name, configPath, before, before, warnings);
    }

    try {
      const existingServers = await this.readServers(scope);
      if (Object.prototype.hasOwnProperty.call(existingServers, spec.name)) {
        warnings.push(`Server "${spec.name}" already exists and will be overwritten.`);
      }

      const transformed = this.transformSpec(spec);
      const serverPath = [...this.getRootPath(scope), spec.name];
      const after = await this.applySetProperty(before, serverPath, transformed);

      if (after !== before) {
        await this.persistConfig(pathInfo.path, before, after);
      }

      if (this.restartRequired) {
        warnings.push(`Restart ${this.displayName} to apply changes.`);
      }

      return this.buildChange('add', spec.name, pathInfo.path, before, after, warnings);
    } catch (error) {
      warnings.push(
        `Failed to add server "${spec.name}" for ${this.displayName}: ${String(error)}`,
      );
      return this.buildChange('add', spec.name, pathInfo.path, before, before, warnings);
    }
  }

  async removeServer(name: string, scope: ConfigScope): Promise<ConfigChange> {
    const pathInfo = this.getConfigPathForScope(scope);
    const configPath = pathInfo?.path ?? '';
    const before = configPath ? await this.readConfigSource(configPath) : '{}\n';
    const warnings: string[] = [];

    if (!this.supportsScope(scope)) {
      warnings.push(
        `Scope "${scope}" is not supported by ${this.displayName}. Supported scopes: ${this.supportedScopes.join(', ')}`,
      );
      return this.buildChange('remove', name, configPath, before, before, warnings);
    }

    if (!pathInfo) {
      warnings.push(`No config path is available for scope "${scope}" in ${this.displayName}.`);
      return this.buildChange('remove', name, configPath, before, before, warnings);
    }

    try {
      const existingServers = await this.readServers(scope);
      if (!Object.prototype.hasOwnProperty.call(existingServers, name)) {
        warnings.push(`Server "${name}" not found.`);
        return this.buildChange('remove', name, pathInfo.path, before, before, warnings);
      }

      const serverPath = [...this.getRootPath(scope), name];
      const after = await this.applyRemoveProperty(before, serverPath);

      if (after !== before) {
        await this.persistConfig(pathInfo.path, before, after);
      }

      if (this.restartRequired) {
        warnings.push(`Restart ${this.displayName} to apply changes.`);
      }

      return this.buildChange('remove', name, pathInfo.path, before, after, warnings);
    } catch (error) {
      warnings.push(
        `Failed to remove server "${name}" for ${this.displayName}: ${String(error)}`,
      );
      return this.buildChange('remove', name, pathInfo.path, before, before, warnings);
    }
  }

  private async readConfigObject(configPath: string): Promise<Record<string, unknown>> {
    if (typeof manager.readConfig === 'function') {
      const parsed = await manager.readConfig(configPath);
      return isRecord(parsed) ? parsed : {};
    }

    const source = await this.readConfigSource(configPath);
    return this.parseJsonObject(source);
  }

  private async readConfigSource(configPath: string): Promise<string> {
    if (!existsSync(configPath)) {
      return '{}\n';
    }

    try {
      return await readFile(configPath, 'utf8');
    } catch {
      return '{}\n';
    }
  }

  private parseJsonObject(source: string): Record<string, unknown> {
    const errors: ParseError[] = [];
    const parsed = parse(source, errors, {
      allowEmptyContent: true,
      allowTrailingComma: true,
    });
    if (errors.length > 0 || !isRecord(parsed)) {
      return {};
    }
    return parsed;
  }

  private getFromPath(source: Record<string, unknown>, path: JsonPath): unknown {
    let current: unknown = source;

    for (const segment of path) {
      if (!isRecord(current)) {
        return undefined;
      }
      current = current[String(segment)];
    }

    return current;
  }

  private setPathValue(
    source: Record<string, unknown>,
    path: JsonPath,
    value: unknown,
  ): Record<string, unknown> {
    if (path.length === 0) {
      return source;
    }

    let cursor: Record<string, unknown> = source;

    for (let i = 0; i < path.length - 1; i += 1) {
      const segment = String(path[i]);
      const next = cursor[segment];
      if (!isRecord(next)) {
        cursor[segment] = {};
      }
      cursor = cursor[segment] as Record<string, unknown>;
    }

    cursor[String(path[path.length - 1])] = value;
    return source;
  }

  private removePathValue(source: Record<string, unknown>, path: JsonPath): Record<string, unknown> {
    if (path.length === 0) {
      return source;
    }

    let cursor: Record<string, unknown> = source;

    for (let i = 0; i < path.length - 1; i += 1) {
      const segment = String(path[i]);
      const next = cursor[segment];
      if (!isRecord(next)) {
        return source;
      }
      cursor = next;
    }

    delete cursor[String(path[path.length - 1])];
    return source;
  }

  private async applySetProperty(
    source: string,
    path: JsonPath,
    value: unknown,
  ): Promise<string> {
    if (
      path.length === 2 &&
      typeof path[0] === 'string' &&
      !path[0].includes('.') &&
      typeof path[1] === 'string' &&
      typeof manager.deepMergeServer === 'function'
    ) {
      return manager.deepMergeServer(
        source,
        path[0],
        path[1],
        isRecord(value) ? value : { value },
      );
    }

    if (typeof manager.setProperty === 'function') {
      return manager.setProperty(source, path, value);
    }

    const parsed = this.parseJsonObject(source);
    const next = this.setPathValue(parsed, path, value);
    return `${JSON.stringify(next, null, 2)}\n`;
  }

  private async applyRemoveProperty(source: string, path: JsonPath): Promise<string> {
    if (typeof manager.removeProperty === 'function') {
      return manager.removeProperty(source, path);
    }

    const parsed = this.parseJsonObject(source);
    const next = this.removePathValue(parsed, path);
    return `${JSON.stringify(next, null, 2)}\n`;
  }

  private async persistConfig(configPath: string, before: string, after: string): Promise<void> {
    if (typeof manager.writeConfig === 'function') {
      const parsedAfter = this.parseJsonObject(after);
      await manager.writeConfig(configPath, parsedAfter, before);
      return;
    }

    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, after, 'utf8');
  }

  private buildChange(
    action: 'add' | 'remove',
    serverName: string,
    configPath: string,
    before: string,
    after: string,
    warnings: string[],
  ): ConfigChange {
    return {
      action,
      after,
      agent: this.id,
      before,
      configPath,
      serverName,
      warning: warnings.length > 0 ? warnings.join(' ') : undefined,
    };
  }
}
