import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

import type { BackupEntry } from '../types/index.js';

interface BackupManifest {
  entries: BackupEntry[];
}

const DEFAULT_BACKUP_ROOT = path.join(homedir(), '.everymcp', 'backups');
const MANIFEST_FILE = 'manifest.json';

function timestampKey(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-');
}

function sanitizeFileName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function sortByNewest(entries: BackupEntry[]): BackupEntry[] {
  return [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function pathsEqual(a: string, b: string): boolean {
  const resolvedA = path.resolve(a);
  const resolvedB = path.resolve(b);

  if (process.platform === 'win32') {
    return resolvedA.toLowerCase() === resolvedB.toLowerCase();
  }

  return resolvedA === resolvedB;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export class BackupManager {
  private readonly backupRoot: string;
  private readonly manifestPath: string;
  private manifestLock: Promise<void> = Promise.resolve();

  constructor(backupRoot: string = DEFAULT_BACKUP_ROOT) {
    this.backupRoot = backupRoot;
    this.manifestPath = path.join(this.backupRoot, MANIFEST_FILE);
  }

  async createBackup(agentId: string, configPath: string): Promise<BackupEntry | null> {
    const sourcePath = path.resolve(configPath);

    if (!(await exists(sourcePath))) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const filename = `${timestampKey(timestamp)}-${sanitizeFileName(path.basename(sourcePath))}`;
    const agentBackupDir = path.join(this.backupRoot, agentId);
    const backupPath = path.join(agentBackupDir, filename);

    await mkdir(agentBackupDir, { recursive: true });
    await copyFile(sourcePath, backupPath);

    const entry: BackupEntry = {
      agent: agentId,
      configPath: sourcePath,
      backupPath,
      timestamp,
    };

    await this.withManifestLock(async () => {
      const manifest = await this.readManifest();
      manifest.entries.push(entry);
      await this.writeManifest(manifest);
    });

    return entry;
  }

  async listBackups(agentId?: string): Promise<BackupEntry[]> {
    return this.withManifestLock(async () => {
      const manifest = await this.readManifest();
      const filtered = agentId
        ? manifest.entries.filter((entry) => entry.agent === agentId)
        : manifest.entries;

      return sortByNewest(filtered);
    });
  }

  async restoreBackup(backupEntry: BackupEntry): Promise<BackupEntry | null> {
    if (!(await exists(backupEntry.backupPath))) {
      throw new Error(`Backup file not found: ${backupEntry.backupPath}`);
    }

    const reversibleBackup = await this.createBackup(backupEntry.agent, backupEntry.configPath);

    await mkdir(path.dirname(backupEntry.configPath), { recursive: true });
    await copyFile(backupEntry.backupPath, backupEntry.configPath);

    return reversibleBackup;
  }

  async getLatestBackup(agentId: string, configPath: string): Promise<BackupEntry | null> {
    const backups = await this.listBackups(agentId);

    return backups.find((entry) => pathsEqual(entry.configPath, configPath)) ?? null;
  }

  private async readManifest(): Promise<BackupManifest> {
    if (!(await exists(this.manifestPath))) {
      return { entries: [] };
    }

    const source = await readFile(this.manifestPath, 'utf8');
    const parsed = JSON.parse(source) as Partial<BackupManifest>;

    if (!Array.isArray(parsed.entries)) {
      return { entries: [] };
    }

    return {
      entries: parsed.entries.filter((entry): entry is BackupEntry => {
        return (
          typeof entry?.agent === 'string' &&
          typeof entry?.configPath === 'string' &&
          typeof entry?.backupPath === 'string' &&
          typeof entry?.timestamp === 'string'
        );
      }),
    };
  }

  private async writeManifest(manifest: BackupManifest): Promise<void> {
    await mkdir(path.dirname(this.manifestPath), { recursive: true });

    const tempPath = `${this.manifestPath}.tmp`;
    const payload = `${JSON.stringify({ entries: sortByNewest(manifest.entries) }, null, 2)}\n`;

    await writeFile(tempPath, payload, 'utf8');
    await rename(tempPath, this.manifestPath);
  }

  private async withManifestLock<T>(operation: () => Promise<T>): Promise<T> {
    const nextOperation = this.manifestLock.then(operation, operation);

    this.manifestLock = nextOperation.then(
      () => undefined,
      () => undefined,
    );

    return nextOperation;
  }
}

const defaultBackupManager = new BackupManager();

export async function createBackup(agentId: string, configPath: string): Promise<BackupEntry | null> {
  return defaultBackupManager.createBackup(agentId, configPath);
}

export async function listBackups(agentId?: string): Promise<BackupEntry[]> {
  return defaultBackupManager.listBackups(agentId);
}

export async function restoreBackup(backupEntry: BackupEntry): Promise<BackupEntry | null> {
  return defaultBackupManager.restoreBackup(backupEntry);
}

export async function getLatestBackup(agentId: string, configPath: string): Promise<BackupEntry | null> {
  return defaultBackupManager.getLatestBackup(agentId, configPath);
}
