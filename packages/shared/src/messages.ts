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
  ExportOptions,
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
      sortColumn?: string;
      sortDirection?: 'asc' | 'desc';
      where?: string;
    }
  | { type: 'getTableDDL'; connectionId: string; table: string; schema?: string }
  | { type: 'exportData'; connectionId: string; table: string; schema?: string; format: 'csv' | 'json' | 'sql'; options?: ExportOptions }
  | { type: 'redisScan'; connectionId: string; pattern: string; cursor: string; count?: number; db?: number }
  | { type: 'redisGet'; connectionId: string; key: string }
  | { type: 'redisSet'; connectionId: string; key: string; value: string; ttl?: number }
  | { type: 'redisDel'; connectionId: string; keys: string[] }
  | { type: 'redisSelectDb'; connectionId: string; db: number }
  | { type: 'redisAddKey'; connectionId: string; key: string; keyType: string; value: string; ttl?: number }
  | { type: 'browseFile'; target: 'sqlite' | 'sshKey' }
  | { type: 'exportQueryResults'; format: 'csv' | 'json' | 'xml'; content: string; defaultFileName: string }
  | { type: 'exportQueryResultsXlsx'; columns: ColumnMeta[]; rows: Record<string, unknown>[]; defaultFileName: string }
  | {
      type: 'exportTableData';
      connectionId: string;
      table: string;
      schema?: string;
      format: 'csv' | 'xlsx' | 'json' | 'xml';
      where?: string;
      sortColumn?: string;
      sortDirection?: 'asc' | 'desc';
    }
  | { type: 'importData'; connectionId: string; table: string; schema?: string }
  | { type: 'getSchemas'; connectionId: string; database?: string }
  | { type: 'switchQueryContext'; connectionId: string; database?: string; schema?: string }
  | { type: 'documentChange'; content: string }
  | { type: 'saveQueryToFile'; content: string }
  | { type: 'openExternal'; url: string }
  | { type: 'aiGenerateQuery'; connectionId: string; prompt: string; provider: 'openai' | 'google' }
  | { type: 'aiRefineQuery'; connectionId: string; sql: string; instruction?: string; provider: 'openai' | 'google' }
  | { type: 'aiConfigureKey'; provider: 'openai' | 'google'; action: 'save' | 'remove'; key?: string }
  | { type: 'aiGetKeyStatus'; provider: 'openai' | 'google' }
  | { type: 'executeMultipleQueries'; connectionId: string; sqls: string[]; queryId: string };

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
      offset: number;
      primaryKeys: string[];
    }
  | { type: 'tableDDL'; connectionId: string; table: string; ddl: string }
  | { type: 'editResult'; success: boolean; error?: string }
  | { type: 'exportComplete'; filePath: string }
  | { type: 'exportError'; error: string }
  | { type: 'exportProgress'; percent: number; message: string }
  | { type: 'importProgress'; percent: number; message: string }
  | { type: 'importComplete'; rowCount: number }
  | { type: 'importError'; error: string }
  | {
      type: 'redisKeys';
      connectionId: string;
      keys: RedisKeyInfo[];
      cursor: string;
      hasMore: boolean;
    }
  | { type: 'redisValue'; connectionId: string; value: RedisValue }
  | { type: 'filePicked'; target: 'sqlite' | 'sshKey'; path: string }
  | { type: 'databaseList'; connectionId: string; databases: string[] }
  | { type: 'schemaList'; connectionId: string; schemas: string[] }
  | { type: 'documentContent'; content: string }
  | { type: 'error'; message: string }
  | { type: 'aiQueryResult'; sql: string; mode: 'generate' | 'refine' }
  | { type: 'aiQueryError'; error: string }
  | { type: 'aiKeyStatus'; provider: 'openai' | 'google'; hasKey: boolean }
  | {
      type: 'multiQueryResult';
      results: {
        index: number;
        sql: string;
        status: 'ok' | 'error';
        executionTime: number;
        affectedRows?: number;
        columns?: ColumnMeta[];
        rows?: Record<string, unknown>[];
        error?: string;
      }[];
      totalTime: number;
    }
  | { type: 'refreshTableData' };

// Re-export used types to avoid unused import warnings
export type { ConnectionConfig, ConnectionInfo, QueryResult, TableEdit, RedisKeyInfo, RedisValue, SchemaInfo, DatabaseInfo, ColumnMeta, ExportOptions };
