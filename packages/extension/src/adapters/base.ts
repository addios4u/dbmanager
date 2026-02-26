import type {
  QueryResult,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  RedisValue,
} from '@dbmanager/shared';

export interface ScanResult {
  keys: string[];
  cursor: string;
  hasMore: boolean;
}

export interface DatabaseAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<boolean>;
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  cancel(queryId: string): Promise<void>;
  getTables(schema?: string): Promise<TableInfo[]>;
  getColumns(table: string, schema?: string): Promise<ColumnInfo[]>;
  getIndexes(table: string, schema?: string): Promise<IndexInfo[]>;
  getForeignKeys(table: string, schema?: string): Promise<ForeignKeyInfo[]>;
  getPrimaryKey(table: string, schema?: string): Promise<string[]>;
  getTableDDL(table: string, schema?: string): Promise<string>;
  getSchemas(): Promise<string[]>;
  getDatabases(): Promise<string[]>;
  dispose(): void;
}

export interface RedisAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<boolean>;
  scan(pattern: string, cursor: string, count: number): Promise<ScanResult>;
  get(key: string): Promise<RedisValue>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  del(keys: string[]): Promise<number>;
  type(key: string): Promise<string>;
  ttl(key: string): Promise<number>;
  dispose(): void;
}
