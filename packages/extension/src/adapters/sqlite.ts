import * as os from 'node:os';
import * as path from 'node:path';
import type { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, IndexInfo, ForeignKeyInfo, ServerInfo } from '@dbmanager/shared';
import type { DatabaseAdapter } from './base.js';

function resolvePath(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

export class SqliteAdapter implements DatabaseAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;
  private queryCounter = 0;

  constructor(
    private readonly config: ConnectionConfig,
  ) {}

  async connect(): Promise<void> {
    if (!this.config.filepath) {
      throw new Error('SQLite file path is required');
    }
    const resolved = resolvePath(this.config.filepath);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    this.db = new Database(resolved);
    this.db.pragma('journal_mode = WAL');
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
  }

  async ping(): Promise<boolean> {
    if (!this.db) return false;
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.db) throw new Error('Not connected');
    const queryId = `sqlite-${++this.queryCounter}`;
    const start = Date.now();

    const stmt = this.db.prepare(sql);

    if (stmt.reader) {
      const rows = params ? stmt.all(...params) : stmt.all();
      const columns = stmt.columns().map((c: { name: string; type: string | null }) => ({
        name: c.name,
        type: c.type ?? 'TEXT',
        nullable: true,
      }));
      return {
        columns,
        rows: rows as Record<string, unknown>[],
        executionTime: Date.now() - start,
        queryId,
      };
    }

    const result = params ? stmt.run(...params) : stmt.run();
    return {
      columns: [],
      rows: [],
      affectedRows: result.changes as number,
      executionTime: Date.now() - start,
      queryId,
    };
  }

  async cancel(_queryId: string): Promise<void> {
    // SQLite is synchronous, cancel is not applicable
  }

  async getDatabases(): Promise<string[]> {
    return ['main'];
  }

  async getSchemas(): Promise<string[]> {
    return ['main'];
  }

  async getTables(_schema?: string): Promise<TableInfo[]> {
    if (!this.db) throw new Error('Not connected');

    const rows = this.db.prepare(
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table', 'view')
         AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    ).all() as { name: string; type: string }[];

    return rows.map((r): TableInfo => ({
      name: r.name,
      type: r.type === 'view' ? 'view' : 'table',
    }));
  }

  async getColumns(table: string, _schema?: string): Promise<ColumnInfo[]> {
    if (!this.db) throw new Error('Not connected');

    const rows = this.db.prepare(`PRAGMA table_info("${table}")`).all() as {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];

    return rows.map((r): ColumnInfo => ({
      name: r.name,
      type: r.type || 'TEXT',
      nullable: r.notnull === 0,
      defaultValue: r.dflt_value,
      isPrimaryKey: r.pk > 0,
      isAutoIncrement: r.pk > 0 && r.type.toUpperCase() === 'INTEGER',
    }));
  }

  async getIndexes(table: string, _schema?: string): Promise<IndexInfo[]> {
    if (!this.db) throw new Error('Not connected');

    const indexList = this.db.prepare(`PRAGMA index_list("${table}")`).all() as {
      seq: number;
      name: string;
      unique: number;
      origin: string;
    }[];

    const indexes: IndexInfo[] = [];
    for (const idx of indexList) {
      const cols = this.db.prepare(`PRAGMA index_info("${idx.name}")`).all() as {
        seqno: number;
        cid: number;
        name: string;
      }[];

      indexes.push({
        name: idx.name,
        columns: cols.map((c) => c.name),
        isUnique: idx.unique === 1,
        isPrimary: idx.origin === 'pk',
        type: 'BTREE',
      });
    }

    return indexes;
  }

  async getForeignKeys(table: string, _schema?: string): Promise<ForeignKeyInfo[]> {
    if (!this.db) throw new Error('Not connected');

    const rows = this.db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as {
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
    }[];

    return rows.map((r): ForeignKeyInfo => ({
      name: `fk_${table}_${r.from}`,
      column: r.from,
      referencedTable: r.table,
      referencedColumn: r.to,
      onDelete: r.on_delete,
      onUpdate: r.on_update,
    }));
  }

  async getPrimaryKey(table: string, _schema?: string): Promise<string[]> {
    const columns = await this.getColumns(table);
    return columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  }

  async getTableDDL(table: string, _schema?: string): Promise<string> {
    if (!this.db) throw new Error('Not connected');
    const row = this.db.prepare(
      `SELECT sql FROM sqlite_master WHERE name = ?`,
    ).get(table) as { sql: string } | undefined;
    return row?.sql ?? '';
  }

  async getServerInfo(): Promise<ServerInfo> {
    if (!this.db) throw new Error('Not connected');
    const row = this.db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
    return {
      version: row.version,
      productName: 'SQLite',
    };
  }

  dispose(): void {
    void this.disconnect();
  }
}
