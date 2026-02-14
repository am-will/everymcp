export type TransportType = 'stdio' | 'http' | 'sse';

export type ConfigScope = 'global' | 'project';

export interface McpServerSpec {
  name: string;
  transport: TransportType;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  oauth?: { clientId?: string; callbackPort?: number };
  disabled?: boolean;
}

export interface AgentAdapter {
  id: string;
  displayName: string;
  supportedTransports: TransportType[];
  supportedScopes: ConfigScope[];
  restartRequired: boolean;
  detect(): Promise<boolean>;
  getConfigPaths(): ConfigPathInfo[];
  readServers(scope: ConfigScope): Promise<Record<string, any>>;
  addServer(spec: McpServerSpec, scope: ConfigScope): Promise<ConfigChange>;
  removeServer(name: string, scope: ConfigScope): Promise<ConfigChange>;
  transformSpec(spec: McpServerSpec): Record<string, any>;
  supportsScope(scope: ConfigScope): boolean;
  supportsTransport(transport: TransportType): boolean;
}

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
  warning?: string;
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
