import type {
  ConnectionConfig,
  ConnectionInfo,
  QueryResult,
  TableEdit,
  RedisKeyInfo,
  RedisValue,
  SchemaInfo,
  DatabaseInfo,
  ColumnMeta,
} from './types.js';

// Webview → Extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'executeQuery'; connectionId: string; sql: string }
  | { type: 'cancelQuery'; queryId: string }
  | { type: 'testConnection'; config: ConnectionConfig; password?: string; sshPassword?: string; sshPassphrase?: string }
  | { type: 'testSshTunnel'; config: ConnectionConfig; sshPassword?: string; sshPassphrase?: string }
  | { type: 'saveConnection'; config: ConnectionConfig; password?: string; sshPassword?: string; sshPassphrase?: string }
  | { type: 'deleteConnection'; connectionId: string }
  | { type: 'connect'; connectionId: string }
  | { type: 'disconnect'; connectionId: string }
  | { type: 'getSchema'; connectionId: string }
  | { type: 'getDatabases'; connectionId: string }
  | { type: 'fetchPage'; queryId: string; offset: number; limit: number }
  | { type: 'saveTableEdits'; connectionId: string; edits: TableEdit[] }
  | {
      type: 'getTableData';
      connectionId: string;
      table: string;
      schema?: string;
      offset?: number;
      limit?: number;
    }
  | { type: 'getTableDDL'; connectionId: string; table: string; schema?: string }
  | { type: 'exportData'; connectionId: string; table: string; format: 'csv' | 'json' | 'sql' }
  | { type: 'redisScan'; connectionId: string; pattern: string; cursor: string; count?: number }
  | { type: 'redisGet'; connectionId: string; key: string }
  | { type: 'redisSet'; connectionId: string; key: string; value: string; ttl?: number }
  | { type: 'redisDel'; connectionId: string; keys: string[] }
  | { type: 'browseFile'; target: 'sqlite' | 'sshKey' };

// Extension → Webview
export type ExtensionMessage =
  | { type: 'stateSync'; connections: ConnectionInfo[]; activeConnectionId?: string }
  | {
      type: 'queryResult';
      queryId: string;
      columns: ColumnMeta[];
      rows: Record<string, unknown>[];
      totalRows?: number;
      executionTime: number;
    }
  | { type: 'queryError'; queryId: string; error: string }
  | { type: 'connectionTestResult'; success: boolean; error?: string }
  | { type: 'sshTunnelTestResult'; success: boolean; error?: string }
  | { type: 'schemaData'; connectionId: string; databases: DatabaseInfo[] }
  | {
      type: 'tableData';
      connectionId: string;
      table: string;
      columns: ColumnMeta[];
      rows: Record<string, unknown>[];
      totalRows: number;
    }
  | { type: 'tableDDL'; connectionId: string; table: string; ddl: string }
  | { type: 'editResult'; success: boolean; error?: string }
  | { type: 'exportComplete'; filePath: string }
  | { type: 'exportError'; error: string }
  | {
      type: 'redisKeys';
      connectionId: string;
      keys: RedisKeyInfo[];
      cursor: string;
      hasMore: boolean;
    }
  | { type: 'redisValue'; connectionId: string; value: RedisValue }
  | { type: 'filePicked'; target: 'sqlite' | 'sshKey'; path: string }
  | { type: 'error'; message: string };

// Re-export used types to avoid unused import warnings
export type { ConnectionConfig, ConnectionInfo, QueryResult, TableEdit, RedisKeyInfo, RedisValue, SchemaInfo, DatabaseInfo, ColumnMeta };
