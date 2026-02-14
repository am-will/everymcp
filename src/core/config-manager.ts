import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type FormattingOptions,
  type JSONPath,
  type ParseError,
} from 'jsonc-parser';

const PARSE_OPTIONS = {
  allowEmptyContent: true,
  allowTrailingComma: true,
};

const FORMAT_OPTIONS: FormattingOptions = {
  tabSize: 2,
  insertSpaces: true,
  eol: '\n',
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;

type DiffOperation =
  | { type: 'set'; path: JSONPath; value: JsonValue }
  | { type: 'remove'; path: JSONPath };

const fileLocks = new Map<string, Promise<void>>();

export async function readConfig(configPath: string): Promise<JsonObject> {
  const source = await readFileOrEmpty(configPath);
  if (!source.trim()) {
    return {};
  }

  const parsed = parseJsonObject(source, configPath, 'readConfig');
  if (!parsed.ok) {
    return {};
  }

  return parsed.value;
}

export async function writeConfig(
  configPath: string,
  data: object,
  originalSource?: string,
): Promise<void> {
  const targetData = normalizeDataObject(data);

  await withFileLock(configPath, async () => {
    const currentSource = await readFileOrEmpty(configPath);

    if (currentSource.trim()) {
      const currentParsed = parseJsonObject(currentSource, configPath, 'writeConfig current source');
      if (!currentParsed.ok) {
        console.warn(
          `[config-manager] Skipping write for malformed JSONC: ${configPath}. Fix the file manually first.`,
        );
        return;
      }
    }

    let nextSource = '';

    if (originalSource !== undefined) {
      if (originalSource.trim()) {
        const originalParsed = parseJsonObject(originalSource, configPath, 'writeConfig original source');
        if (!originalParsed.ok) {
          console.warn(
            `[config-manager] Skipping write because originalSource is malformed for: ${configPath}.`,
          );
          return;
        }

        const baseline = originalParsed.value;
        const operations = diffValues(baseline, targetData, []);
        nextSource = applyOperationsToSource(currentSource, operations, configPath);
      } else {
        nextSource = applyObjectToSource(currentSource, targetData, configPath);
      }
    } else {
      nextSource = currentSource.trim()
        ? applyObjectToSource(currentSource, targetData, configPath)
        : `${JSON.stringify(targetData, null, 2)}\n`;
    }

    await writeFileAtomic(configPath, nextSource);
  });
}

export function setProperty(source: string, jsonPath: JSONPath, value: unknown): string {
  const workingSource = source.trim() ? source : '{}';

  if (!isValidJsonc(workingSource)) {
    console.warn('[config-manager] setProperty skipped due to malformed JSONC source.');
    return source;
  }

  try {
    const edits = modify(workingSource, jsonPath, value, {
      formattingOptions: FORMAT_OPTIONS,
    });

    return applyEdits(workingSource, edits);
  } catch (error) {
    console.warn(
      `[config-manager] setProperty failed at path ${formatPath(jsonPath)}: ${(error as Error).message}`,
    );
    return source;
  }
}

export function removeProperty(source: string, jsonPath: JSONPath): string {
  if (!source.trim()) {
    return source;
  }

  if (!isValidJsonc(source)) {
    console.warn('[config-manager] removeProperty skipped due to malformed JSONC source.');
    return source;
  }

  try {
    const edits = modify(source, jsonPath, undefined, {
      formattingOptions: FORMAT_OPTIONS,
    });

    return applyEdits(source, edits);
  } catch (error) {
    console.warn(
      `[config-manager] removeProperty failed at path ${formatPath(jsonPath)}: ${(error as Error).message}`,
    );
    return source;
  }
}

export function deepMergeServer(
  source: string,
  rootKey: string,
  serverName: string,
  serverConfig: object,
): string {
  const rootPath = parseRootKey(rootKey);
  const serverPath: JSONPath = [...rootPath, serverName];

  return setProperty(source, serverPath, serverConfig);
}

async function withFileLock<T>(configPath: string, operation: () => Promise<T>): Promise<T> {
  const lockKey = path.resolve(configPath);
  const previous = (fileLocks.get(lockKey) ?? Promise.resolve()).catch(() => undefined);

  let releaseLock!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  const queued = previous.then(() => current);
  fileLocks.set(lockKey, queued);

  await previous;

  try {
    return await operation();
  } finally {
    releaseLock();
    if (fileLocks.get(lockKey) === queued) {
      fileLocks.delete(lockKey);
    }
  }
}

function parseRootKey(rootKey: string): JSONPath {
  return rootKey
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function normalizeDataObject(data: object): JsonObject {
  if (isPlainObject(data)) {
    return data as JsonObject;
  }

  return {};
}

function applyObjectToSource(source: string, targetData: JsonObject, configPath: string): string {
  const workingSource = source.trim() ? source : '{}';
  const parsedCurrent = parseJsonObject(workingSource, configPath, 'applyObjectToSource');

  if (!parsedCurrent.ok) {
    return source;
  }

  const operations = diffValues(parsedCurrent.value, targetData, []);
  return applyOperationsToSource(workingSource, operations, configPath);
}

function applyOperationsToSource(source: string, operations: DiffOperation[], configPath: string): string {
  let nextSource = source.trim() ? source : '{}';

  for (const operation of operations) {
    nextSource =
      operation.type === 'set'
        ? setProperty(nextSource, operation.path, operation.value)
        : removeProperty(nextSource, operation.path);
  }

  if (!isValidJsonc(nextSource)) {
    console.warn(`[config-manager] Generated malformed JSONC for ${configPath}; skipping write.`);
    return source;
  }

  return nextSource;
}

function diffValues(current: JsonValue | undefined, target: JsonValue | undefined, basePath: JSONPath): DiffOperation[] {
  if (target === undefined) {
    return current === undefined ? [] : [{ type: 'remove', path: basePath }];
  }

  if (current === undefined) {
    return [{ type: 'set', path: basePath, value: target }];
  }

  if (isPlainObject(current) && isPlainObject(target)) {
    const currentRecord = current as Record<string, JsonValue>;
    const targetRecord = target as Record<string, JsonValue>;
    const operations: DiffOperation[] = [];

    for (const key of Object.keys(currentRecord)) {
      if (!(key in targetRecord)) {
        operations.push({ type: 'remove', path: [...basePath, key] });
      }
    }

    for (const [key, targetValue] of Object.entries(targetRecord)) {
      if (!(key in currentRecord)) {
        operations.push({ type: 'set', path: [...basePath, key], value: targetValue });
        continue;
      }

      operations.push(...diffValues(currentRecord[key], targetValue, [...basePath, key]));
    }

    return operations;
  }

  if (deepEqual(current, target)) {
    return [];
  }

  return [{ type: 'set', path: basePath, value: target }];
}

function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) {
    return true;
  }

  if (a === undefined || b === undefined) {
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }

    for (let index = 0; index < a.length; index += 1) {
      if (!deepEqual(a[index], b[index])) {
        return false;
      }
    }

    return true;
  }

  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) {
      return false;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
      return false;
    }

    for (const key of aKeys) {
      if (!(key in b) || !deepEqual((a as Record<string, JsonValue>)[key], (b as Record<string, JsonValue>)[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function parseJsonObject(
  source: string,
  configPath: string,
  context: string,
): { ok: true; value: JsonObject } | { ok: false } {
  const errors: ParseError[] = [];
  const parsed = parse(source, errors, PARSE_OPTIONS);

  if (errors.length > 0) {
    const message = errors.map((error) => printParseErrorCode(error.error)).join(', ');
    console.warn(`[config-manager] JSONC parse errors in ${configPath} (${context}): ${message}`);
    return { ok: false };
  }

  if (parsed === undefined || parsed === null) {
    return { ok: true, value: {} };
  }

  if (!isPlainObject(parsed)) {
    console.warn(
      `[config-manager] Expected object JSON root in ${configPath} (${context}); found ${typeof parsed}.`,
    );
    return { ok: false };
  }

  return { ok: true, value: parsed as JsonObject };
}

function isValidJsonc(source: string): boolean {
  const errors: ParseError[] = [];
  parse(source, errors, PARSE_OPTIONS);
  return errors.length === 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPath(jsonPath: JSONPath): string {
  if (jsonPath.length === 0) {
    return '<root>';
  }

  return jsonPath.map((segment) => String(segment)).join('.');
}

async function readFileOrEmpty(configPath: string): Promise<string> {
  try {
    return await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

async function writeFileAtomic(configPath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    await fs.writeFile(tempPath, contents, 'utf8');
    await fs.rename(tempPath, configPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);

    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'EACCES' || errno.code === 'EPERM' || errno.code === 'EROFS') {
      throw new Error(
        `Cannot write config file ${configPath} (read-only or permission denied). Check file permissions.`,
      );
    }

    throw error;
  }
}
