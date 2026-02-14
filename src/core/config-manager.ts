import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { applyEdits, modify, parse, type ParseError, type JSONPath } from 'jsonc-parser';

export type { JSONPath };

type JsonObject = Record<string, unknown>;

const fileLocks = new Map<string, Promise<void>>();
const FORMATTING_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
};

const EMPTY_SOURCE = '{}';

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitPath(input: string): JSONPath {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  return trimmed
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}

function deepMergeObjects(base: unknown, incoming: unknown): JsonObject | undefined {
  if (!isPlainObject(base) && !isPlainObject(incoming)) {
    return isPlainObject(incoming) ? { ...incoming } : undefined;
  }

  if (!isPlainObject(base) && isPlainObject(incoming)) {
    return { ...incoming };
  }

  if (isPlainObject(base) && !isPlainObject(incoming)) {
    return { ...base };
  }

  const merged: JsonObject = { ...(base as JsonObject) };
  const source = incoming as JsonObject;

  for (const [key, value] of Object.entries(source)) {
    const existing = merged[key];

    if (isPlainObject(value) && isPlainObject(existing)) {
      merged[key] = deepMergeObjects(existing, value);
      continue;
    }

    if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

function parseSource(source: string, filePath?: string): { value: unknown; errors: ParseError[] } {
  const content = source == null ? '' : source;
  const trimmed = content.trim();

  if (!trimmed.length) {
    return { value: {}, errors: [] };
  }

  const parseErrors: ParseError[] = [];
  const value = parse(content, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (parseErrors.length > 0) {
    const target = filePath ? ` (${filePath})` : '';
    const detail = parseErrors
      .map((entry) => `code=${entry.error} offset=${entry.offset} length=${entry.length}`)
      .join('; ');
    // eslint-disable-next-line no-console
    console.warn(`Malformed JSONC${target}; using safe fallback object. ${detail}`);
  }

  return { value: value === undefined ? {} : value, errors: parseErrors };
}

function buildEditedSource(source: string, jsonPath: JSONPath, value: unknown): string {
  const edits = modify(source, jsonPath, value, {
    formattingOptions: FORMATTING_OPTIONS,
  });

  return applyEdits(source, edits);
}

function withFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const key = normalizePath(filePath);
  const prior = fileLocks.get(key) ?? Promise.resolve<void>(undefined);
  const next = prior.then(() => operation());
  const release = next.then(
    () => undefined,
    () => undefined,
  );

  release.finally(() => {
    if (fileLocks.get(key) === release) {
      fileLocks.delete(key);
    }
  });

  fileLocks.set(key, release);
  return next;
}

function ensureSource(source: string): string {
  return source?.trim().length ? source : EMPTY_SOURCE;
}

function trailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

function walk(obj: unknown, pathParts: JSONPath): unknown {
  let current = obj;

  for (const part of pathParts) {
    if (!isPlainObject(current) && !Array.isArray(current)) {
      return undefined;
    }

    if (isPlainObject(current) && typeof part === 'string' && Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part];
      continue;
    }

    if (Array.isArray(current) && typeof part === 'number' && Number.isInteger(part) && part >= 0 && part < current.length) {
      current = current[part];
      continue;
    }

    return undefined;
  }

  return current;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertWritableTarget(filePath: string): Promise<void> {
  const targetExists = await pathExists(filePath);

  if (!targetExists) {
    const parent = path.dirname(filePath);
    const canWriteDir = await canWrite(parent);

    if (!canWriteDir) {
      throw new Error(`Cannot write config file "${filePath}": parent directory is not writable.`);
    }

    return;
  }

  const canWriteFile = await canWrite(filePath);
  if (!canWriteFile) {
    throw new Error(`Cannot write config file "${filePath}": file is read-only or not writable.`);
  }
}

async function canWrite(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  if (dir && dir !== '.') {
    await mkdir(dir, { recursive: true });
  }
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;

  try {
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, filePath);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        const friendly = new Error(
          `Cannot write config file "${filePath}": file is read-only or destination is protected.`,
        );
        throw friendly;
      }
    }

    throw error;
  } finally {
    await rm(tempPath, { force: true });
  }
}

export async function readConfig(filePath: string): Promise<JsonObject> {
  try {
    const source = await readFile(filePath, 'utf8');
    const { value, errors } = parseSource(source, filePath);

    if (errors.length > 0) {
      return {};
    }

    if (isPlainObject(value)) {
      return value;
    }

    return {};
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

export async function writeConfig(
  filePath: string,
  data: JsonObject,
  originalSource?: string,
): Promise<void> {
  const normalizedPath = normalizePath(filePath);
  const normalizedData = isPlainObject(data) ? data : {};

  const payload = (() => {
    if (typeof originalSource !== 'string') {
      return trailingNewline(JSON.stringify(normalizedData, null, 2));
    }

    const source = ensureSource(originalSource);
    const parsed = parseSource(source, filePath);

    if (parsed.errors.length > 0) {
      return trailingNewline(JSON.stringify(normalizedData, null, 2));
    }

    return trailingNewline(buildEditedSource(source, [], normalizedData));
  })();

  return withFileLock(normalizedPath, async () => {
    await ensureParentDirectory(normalizedPath);
    await assertWritableTarget(normalizedPath);
    await writeAtomic(normalizedPath, payload);
  });
}

export function setProperty(source: string, pathParts: JSONPath, value: unknown): string {
  const sourceText = ensureSource(source);
  const parsed = parseSource(sourceText);

  if (parsed.errors.length > 0) {
    return sourceText;
  }

  return buildEditedSource(sourceText, pathParts, value);
}

export function removeProperty(source: string, pathParts: JSONPath): string {
  const sourceText = ensureSource(source);
  const parsed = parseSource(sourceText);

  if (parsed.errors.length > 0) {
    return sourceText;
  }

  return buildEditedSource(sourceText, pathParts, undefined);
}

export function deepMergeServer(
  source: string,
  rootKey: string,
  serverName: string,
  serverConfig: unknown,
): string {
  const sourceText = ensureSource(source);
  const parsed = parseSource(sourceText);

  if (parsed.errors.length > 0) {
    return sourceText;
  }

  const rootPath = splitPath(rootKey);
  const rootValue = walk(parsed.value, rootPath);
  const existingServers = isPlainObject(rootValue) ? rootValue : {};
  const existingServer =
    typeof serverName === 'string' && isPlainObject(existingServers?.[serverName])
      ? (existingServers[serverName] as JsonObject)
      : {};

  const mergedServer = isPlainObject(serverConfig)
    ? deepMergeObjects(existingServer, serverConfig) ?? serverConfig
    : serverConfig;

  return buildEditedSource(sourceText, [...rootPath, serverName], mergedServer);
}
