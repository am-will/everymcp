/**
 * Shared type definitions for everymcp adapters and configuration operations.
 */

export type TransportType = 'stdio' | 'http' | 'sse';

export interface McpServerSpec {
  name: string;
  transport: TransportType;
  // stdio fields
  command?: string;
  args?: string[];
  // http/sse fields
  url?: string;
  headers?: Record<string, string>;
  // auth
  env?: Record<string, string>;
  oauth?: {
    clientId?: string;
    callbackPort?: number;
  };
  // metadata
  disabled?: boolean;
}

export type ConfigScope = 'global' | 'project';

export interface ConfigPathInfo {
  scope: ConfigScope;
  path: string;
  exists: boolean;
}

export interface ConfigChange {
  agent: string;
  configPath: string;
  before: string;
  after: string;
  action: 'add' | 'remove';
  serverName: string;
  warning?: string; // e.g., "Restart required", "stdio only"
}

export interface AgentAdapter {
  id: string;
  displayName: string;
  supportedTransports: readonly TransportType[];
  supportedScopes: readonly ConfigScope[];
  restartRequired: boolean; // Show "restart required" message after install
  detect(): Promise<boolean>;
  getConfigPaths(): Promise<ConfigPathInfo[]>;
  readServers(scope: ConfigScope): Promise<Record<string, any>>;
  addServer(spec: McpServerSpec, scope: ConfigScope): Promise<ConfigChange>;
  removeServer(name: string, scope: ConfigScope): Promise<ConfigChange>;
  transformSpec(spec: McpServerSpec): Record<string, any>;
  supportsScope(scope: ConfigScope): boolean;
  supportsTransport(transport: TransportType): boolean;
}

export interface DetectedAgent {
  adapter: AgentAdapter;
  detected: boolean;
  configPaths: ConfigPathInfo[];
}

export interface BackupEntry {
  agent: string;
  configPath: string;
  backupPath: string;
  timestamp: string;
}
