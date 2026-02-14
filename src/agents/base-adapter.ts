import { promises as fs } from 'node:fs';
import path from 'node:path';

import { applyEdits, JSONPath, modify, ParseError, parse } from 'jsonc-parser';

import {
  AgentAdapter,
  ConfigChange,
  ConfigPathInfo,
  ConfigScope,
  McpServerSpec,
  TransportType,
} from '../types/index.js';
import { commandExists } from '../utils/platform.js';

export type RootKey = string | string[];

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRootKey(rootKey: RootKey): string[] {
  return Array.isArray(rootKey) ? [...rootKey] : [rootKey];
}

function getByPath(data: unknown, parts: string[]): unknown {
  let current = data;

  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function hasOwn(obj: Record<string, any>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export abstract class BaseAdapter implements AgentAdapter {
  abstract id: string;
  abstract displayName: string;
  abstract supportedTransports: readonly TransportType[];
  abstract supportedScopes: readonly ConfigScope[];
  abstract restartRequired: boolean;

  protected rootKey: RootKey = 'mcpServers';

  protected detectionCommands: string[] = [];

  abstract getConfigPaths(): Promise<ConfigPathInfo[]>;
  abstract transformSpec(spec: McpServerSpec): Record<string, any>;

  async detect(): Promise<boolean> {
    try {
      const paths = await this.getConfigPaths();
      if (paths.some((entry) => entry.exists)) {
        return true;
      }

      return this.detectionCommands.some((command) => commandExists(command));
    } catch {
      return false;
    }
  }

  supportsScope(scope: ConfigScope): boolean {
    return this.supportedScopes.includes(scope);
  }

  supportsTransport(transport: TransportType): boolean {
    return this.supportedTransports.includes(transport);
  }

  async readServers(scope: ConfigScope): Promise<Record<string, any>> {
    const configPath = await this.getConfigPathForScope(scope);
    if (!configPath) {
      return {};
    }

    const { data } = await this.readConfigDocument(configPath);
    const rootPath = normalizeRootKey(this.getRootKey(scope));
    const root = getByPath(data, rootPath);

    return isRecord(root) ? root : {};
  }

  async addServer(spec: McpServerSpec, scope: ConfigScope): Promise<ConfigChange> {
    const warnings: string[] = [];
    const configPath = await this.getConfigPathForScope(scope);

    if (!configPath) {
      warnings.push(`Scope '${scope}' is not configured for ${this.displayName}`);
      return this.buildChange('add', spec.name, configPath ?? '', '', '', warnings.join('; '));
    }

    if (!this.supportsScope(scope)) {
      warnings.push(`Scope '${scope}' is not supported by ${this.displayName}`);
    }

    if (!this.supportsTransport(spec.transport)) {
      warnings.push(`Transport '${spec.transport}' is not supported by ${this.displayName}`);
    }

    if (warnings.length > 0) {
      const doc = await this.readConfigDocument(configPath);
      return this.buildChange('add', spec.name, configPath, doc.source, doc.source, warnings.join('; '));
    }

    const document = await this.readConfigDocument(configPath);
    const existingServers = await this.readServers(scope);
    const rootPath = normalizeRootKey(this.getRootKey(scope));

    if (hasOwn(existingServers, spec.name)) {
      warnings.push(`Server '${spec.name}' already exists in ${this.displayName}`);
    }

    const transformed = this.transformSpec(spec);

    try {
      const after = this.setJsonValue(document.source, [...rootPath, spec.name], transformed);
      await this.writeConfig(configPath, after);

      if (this.restartRequired) {
        warnings.push('Restart required');
      }

      return this.buildChange('add', spec.name, configPath, document.source, after, warnings.join('; ') || undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to write config: ${message}`);
      return this.buildChange('add', spec.name, configPath, document.source, document.source, warnings.join('; '));
    }
  }

  async removeServer(name: string, scope: ConfigScope): Promise<ConfigChange> {
    const warnings: string[] = [];
    const configPath = await this.getConfigPathForScope(scope);

    if (!configPath) {
      warnings.push(`Scope '${scope}' is not configured for ${this.displayName}`);
      return this.buildChange('remove', name, configPath ?? '', '', '', warnings.join('; '));
    }

    if (!this.supportsScope(scope)) {
      warnings.push(`Scope '${scope}' is not supported by ${this.displayName}`);
      const doc = await this.readConfigDocument(configPath);
      return this.buildChange('remove', name, configPath, doc.source, doc.source, warnings.join('; '));
    }

    const document = await this.readConfigDocument(configPath);
    const existingServers = await this.readServers(scope);

    if (!hasOwn(existingServers, name)) {
      warnings.push(`Server '${name}' not found in ${this.displayName}`);
      return this.buildChange('remove', name, configPath, document.source, document.source, warnings.join('; '));
    }

    const rootPath = normalizeRootKey(this.getRootKey(scope));
    const targetPath = [...rootPath, name];

    try {
      const after = this.removeJsonValue(document.source, targetPath);
      await this.writeConfig(configPath, after);

      if (this.restartRequired) {
        warnings.push('Restart required');
      }

      return this.buildChange('remove', name, configPath, document.source, after, warnings.join('; ') || undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to write config: ${message}`);
      return this.buildChange('remove', name, configPath, document.source, document.source, warnings.join('; '));
    }
  }

  protected getRootKey(_scope: ConfigScope): RootKey {
    return this.rootKey;
  }

  protected buildChange(
    action: 'add' | 'remove',
    serverName: string,
    configPath: string,
    before: string,
    after: string,
    warning?: string,
  ): ConfigChange {
    return {
      agent: this.id,
      configPath,
      before,
      after,
      action,
      serverName,
      warning,
    };
  }

  protected getConfigPathForScope(scope: ConfigScope): Promise<string | undefined> {
    return this.getConfigPaths().then((paths) => paths.find((item) => item.scope === scope)?.path);
  }

  protected async readConfigDocument(configPath: string): Promise<{
    source: string;
    data: Record<string, any>;
  }> {
    let source = '';

    try {
      source = await fs.readFile(configPath, 'utf8');
    } catch {
      source = '';
    }

    const normalizedSource = source.trim().length === 0 ? '{}\n' : source;
    const parseErrors: ParseError[] = [];
    const parsed = parse(normalizedSource, parseErrors, {
      allowTrailingComma: true,
      disallowComments: false,
      allowEmptyContent: true,
    }) as unknown;

    const data = isRecord(parsed) ? parsed : {};

    return {
      source: normalizedSource,
      data,
    };
  }

  protected setJsonValue(source: string, jsonPath: string[], value: unknown): string {
    const edits = modify(source, jsonPath as JSONPath, value, {
      formattingOptions: {
        tabSize: 2,
        insertSpaces: true,
        eol: '\n',
      },
    });

    if (edits.length === 0) {
      return source;
    }

    return applyEdits(source, edits);
  }

  protected removeJsonValue(source: string, jsonPath: string[]): string {
    const edits = modify(source, jsonPath as JSONPath, undefined, {
      formattingOptions: {
        tabSize: 2,
        insertSpaces: true,
        eol: '\n',
      },
    });

    if (edits.length === 0) {
      return source;
    }

    return applyEdits(source, edits);
  }

  protected async writeConfig(configPath: string, source: string): Promise<void> {
    await fs.mkdir(path.dirname(configPath), { recursive: true });

    const tmpPath = `${configPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await fs.writeFile(tmpPath, source, 'utf8');
    await fs.rename(tmpPath, configPath);
  }
}
