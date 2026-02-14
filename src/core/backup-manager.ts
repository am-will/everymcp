import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BackupEntry } from '../types/index.js';

const BACKUP_ROOT = path.join(os.homedir(), '.everymcp', 'backups');
const MANIFEST_PATH = path.join(BACKUP_ROOT, 'manifest.json');

interface BackupManifest {
  backups: BackupEntry[];
}

function createTimestamp(): string {
  return new Date().toISOString();
}

function createFilenameTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadManifest(): Promise<BackupManifest> {
  await fs.mkdir(BACKUP_ROOT, { recursive: true });

  if (!(await fileExists(MANIFEST_PATH))) {
    return { backups: [] };
  }

  try {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return { backups: [] };
    }

    if (!Array.isArray((parsed as { backups?: unknown }).backups)) {
      return { backups: [] };
    }

    return parsed as BackupManifest;
  } catch {
    return { backups: [] };
  }
}

async function saveManifest(manifest: BackupManifest): Promise<void> {
  await fs.mkdir(BACKUP_ROOT, { recursive: true });
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

function toSortableTimestamp(entry: BackupEntry): number {
  const timestamp = new Date(entry.timestamp).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export async function createBackup(agentId: string, configPath: string): Promise<BackupEntry | null> {
  if (!(await fileExists(configPath))) {
    return null;
  }

  await fs.mkdir(path.join(BACKUP_ROOT, agentId), { recursive: true });

  const timestamp = createTimestamp();
  const filename = `${createFilenameTimestamp(timestamp)}-${path.basename(configPath)}`;
  const backupPath = path.join(BACKUP_ROOT, agentId, filename);

  await fs.copyFile(configPath, backupPath);

  const backup: BackupEntry = {
    agent: agentId,
    configPath,
    backupPath,
    timestamp,
  };

  const manifest = await loadManifest();
  manifest.backups.push(backup);
  await saveManifest(manifest);

  return backup;
}

export async function listBackups(agentId?: string): Promise<BackupEntry[]> {
  const manifest = await loadManifest();
  const filtered = typeof agentId === 'string'
    ? manifest.backups.filter((backup) => backup.agent === agentId)
    : manifest.backups;

  return [...filtered].sort((a, b) => toSortableTimestamp(b) - toSortableTimestamp(a));
}

export async function restoreBackup(backupEntry: BackupEntry): Promise<BackupEntry | null> {
  if (!(await fileExists(backupEntry.backupPath))) {
    throw new Error(`Backup file not found: ${backupEntry.backupPath}`);
  }

  let preRestoreBackup: BackupEntry | null = null;

  if (await fileExists(backupEntry.configPath)) {
    preRestoreBackup = await createBackup(backupEntry.agent, backupEntry.configPath);
  }

  await fs.mkdir(path.dirname(backupEntry.configPath), { recursive: true });
  await fs.copyFile(backupEntry.backupPath, backupEntry.configPath);

  return preRestoreBackup;
}

export async function getLatestBackup(agentId: string, configPath: string): Promise<BackupEntry | null> {
  const agentBackups = await listBackups(agentId);
  return agentBackups.find((backup) => backup.configPath === configPath) ?? null;
}
