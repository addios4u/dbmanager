export type DatabaseType = 'mysql' | 'mariadb' | 'postgresql' | 'sqlite' | 'redis';

export interface SshConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'privateKey';
  privateKeyPath?: string;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  type: DatabaseType;
  host?: string;
  port?: number;
  username?: string;
  database?: string;
  filepath?: string; // SQLite
  ssl?: boolean;
  group?: string;
  color?: string;
  ssh?: SshConfig;
  redisDelimiter?: string; // Redis key tree delimiter (default: ':')
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  affectedRows?: number;
  executionTime: number;
  queryId: string;
}

export interface ColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
}

export interface TableInfo {
  name: string;
  schema?: string;
  type: 'table' | 'view';
  rowCount?: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  comment?: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  type: string;
}

export interface ForeignKeyInfo {
  name: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: string;
  onUpdate: string;
}

export interface SchemaInfo {
  name: string;
  tables: TableInfo[];
}

export interface DatabaseInfo {
  name: string;
  schemas?: SchemaInfo[];
  tables?: TableInfo[];
}

export interface RedisKeyInfo {
  key: string;
  type: string;
  ttl: number;
}

export interface RedisValue {
  key: string;
  type: string;
  value: unknown;
  ttl: number;
}

export interface TableEdit {
  type: 'insert' | 'update' | 'delete';
  table: string;
  primaryKey: Record<string, unknown>;
  changes: Record<string, unknown>;
}

export type ViewState =
  | { view: 'welcome' }
  | { view: 'query'; connectionId: string }
  | { view: 'tableData'; connectionId: string; table: string; schema?: string; database?: string }
  | { view: 'schemaView'; connectionId: string; table: string; schema?: string }
  | { view: 'ddl'; connectionId: string; table: string; schema?: string }
  | { view: 'redis'; connectionId: string; db?: number }
  | { view: 'export'; connectionId: string; table: string; schema?: string }
  | { view: 'connectionDialog'; editId?: string };

export interface ConnectionInfo extends ConnectionConfig {
  isConnected: boolean;
}

export interface ServerInfo {
  version: string;
  productName?: string;
  charset?: string;
  uptime?: number; // seconds
  extras?: Record<string, string>;
}

export type PanelKind = 'query' | 'tableData' | 'tableEditor' | 'connectionDialog' | 'ddl' | 'export' | 'redis';

export interface PanelMeta {
  kind: PanelKind;
  connectionId?: string;
  tableName?: string;
  schema?: string;
  database?: string;
  editId?: string;
  redisDb?: number;
  initialSql?: string;
}

export interface ExportOptions {
  format: 'csv' | 'json' | 'sql';
  includeHeaders?: boolean; // CSV
  prettyPrint?: boolean; // JSON
  includeDropStatement?: boolean; // SQL
  delimiter?: string; // CSV delimiter
}
