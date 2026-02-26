import type { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, IndexInfo, ForeignKeyInfo, ServerInfo } from '@dbmanager/shared';
import type { DatabaseAdapter } from './base.js';

export class MysqlAdapter implements DatabaseAdapter {
  protected pool: import('mysql2/promise').Pool | undefined;
  private queryCounter = 0;

  constructor(
    protected readonly config: ConnectionConfig,
    protected readonly password?: string,
    protected readonly connectHost?: string,
    protected readonly connectPort?: number,
  ) {}

  async connect(): Promise<void> {
    const mysql = await import('mysql2/promise');
    this.pool = mysql.createPool({
      host: this.connectHost ?? this.config.host ?? 'localhost',
      port: this.connectPort ?? this.config.port ?? 3306,
      user: this.config.username || undefined,
      password: this.password || undefined,
      database: this.config.database || undefined,
      connectionLimit: 5,
      connectTimeout: 10000,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
    });
    // Verify connection
    const conn = await this.pool.getConnection();
    conn.release();
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = undefined;
    }
  }

  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected');
    const queryId = `mysql-${++this.queryCounter}`;
    const start = Date.now();
    const [rows, fields] = await this.pool.query(sql, params);

    if (Array.isArray(rows)) {
      const columns = (fields as import('mysql2').FieldPacket[])?.map((f) => ({
        name: f.name,
        type: String(f.type ?? ''),
        nullable: (f.flags ?? 0) === 0,
      })) ?? [];
      return {
        columns,
        rows: rows as Record<string, unknown>[],
        executionTime: Date.now() - start,
        queryId,
      };
    }

    // INSERT/UPDATE/DELETE result
    const result = rows as import('mysql2').ResultSetHeader;
    return {
      columns: [],
      rows: [],
      affectedRows: result.affectedRows,
      executionTime: Date.now() - start,
      queryId,
    };
  }

  async cancel(_queryId: string): Promise<void> {
    // MySQL cancel requires KILL QUERY on the connection thread id
    // For simplicity, this is a no-op for now
  }

  async getDatabases(): Promise<string[]> {
    if (!this.pool) throw new Error('Not connected');
    const [rows] = await this.pool.query('SHOW DATABASES');
    return (rows as Record<string, unknown>[]).map((r) => String(r['Database'] ?? r['database'] ?? ''));
  }

  async getSchemas(): Promise<string[]> {
    // MySQL: schema = database
    return this.getDatabases();
  }

  async getTables(schema?: string): Promise<TableInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const db = schema ?? this.config.database;
    if (!db) return [];

    const [rows] = await this.pool.query(
      `SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [db],
    );

    return (rows as Record<string, unknown>[]).map((r): TableInfo => ({
      name: String(r['TABLE_NAME']),
      schema: db,
      type: String(r['TABLE_TYPE']).includes('VIEW') ? 'view' : 'table',
      rowCount: r['TABLE_ROWS'] != null ? Number(r['TABLE_ROWS']) : undefined,
    }));
  }

  async getColumns(table: string, schema?: string): Promise<ColumnInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const db = schema ?? this.config.database;

    const [rows] = await this.pool.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
              COLUMN_KEY, EXTRA, COLUMN_COMMENT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [db, table],
    );

    return (rows as Record<string, unknown>[]).map((r): ColumnInfo => ({
      name: String(r['COLUMN_NAME']),
      type: String(r['COLUMN_TYPE']),
      nullable: String(r['IS_NULLABLE']) === 'YES',
      defaultValue: r['COLUMN_DEFAULT'] != null ? String(r['COLUMN_DEFAULT']) : null,
      isPrimaryKey: String(r['COLUMN_KEY']) === 'PRI',
      isAutoIncrement: String(r['EXTRA']).includes('auto_increment'),
      comment: r['COLUMN_COMMENT'] ? String(r['COLUMN_COMMENT']) : undefined,
    }));
  }

  async getIndexes(table: string, schema?: string): Promise<IndexInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const db = schema ?? this.config.database;

    const [rows] = await this.pool.query(
      `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [db, table],
    );

    const indexMap = new Map<string, IndexInfo>();
    for (const r of rows as Record<string, unknown>[]) {
      const name = String(r['INDEX_NAME']);
      const existing = indexMap.get(name);
      if (existing) {
        existing.columns.push(String(r['COLUMN_NAME']));
      } else {
        indexMap.set(name, {
          name,
          columns: [String(r['COLUMN_NAME'])],
          isUnique: Number(r['NON_UNIQUE']) === 0,
          isPrimary: name === 'PRIMARY',
          type: String(r['INDEX_TYPE']),
        });
      }
    }

    return [...indexMap.values()];
  }

  async getForeignKeys(table: string, schema?: string): Promise<ForeignKeyInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const db = schema ?? this.config.database;

    const [rows] = await this.pool.query(
      `SELECT kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME,
              kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
              rc.DELETE_RULE, rc.UPDATE_RULE
       FROM information_schema.KEY_COLUMN_USAGE kcu
       JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
         ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
         AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
       WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ?
         AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
      [db, table],
    );

    return (rows as Record<string, unknown>[]).map((r): ForeignKeyInfo => ({
      name: String(r['CONSTRAINT_NAME']),
      column: String(r['COLUMN_NAME']),
      referencedTable: String(r['REFERENCED_TABLE_NAME']),
      referencedColumn: String(r['REFERENCED_COLUMN_NAME']),
      onDelete: String(r['DELETE_RULE']),
      onUpdate: String(r['UPDATE_RULE']),
    }));
  }

  async getPrimaryKey(table: string, schema?: string): Promise<string[]> {
    const indexes = await this.getIndexes(table, schema);
    const pk = indexes.find((idx) => idx.isPrimary);
    return pk?.columns ?? [];
  }

  async getTableDDL(table: string, schema?: string): Promise<string> {
    if (!this.pool) throw new Error('Not connected');
    const db = schema ?? this.config.database;
    const fullName = db ? `\`${db}\`.\`${table}\`` : `\`${table}\``;
    const [rows] = await this.pool.query(`SHOW CREATE TABLE ${fullName}`);
    const row = (rows as Record<string, unknown>[])[0];
    return String(row?.['Create Table'] ?? row?.['Create View'] ?? '');
  }

  async getServerInfo(): Promise<ServerInfo> {
    if (!this.pool) throw new Error('Not connected');

    const [[versionRows], [charsetRows], [uptimeRows]] = await Promise.all([
      this.pool.query('SELECT VERSION() AS version'),
      this.pool.query("SHOW VARIABLES LIKE 'character_set_server'"),
      this.pool.query("SHOW STATUS LIKE 'Uptime'"),
    ]);

    const versionStr = String((versionRows as Record<string, unknown>[])[0]?.['version'] ?? '');
    const charset = (charsetRows as Record<string, unknown>[])[0]?.['Value'];
    const uptime = (uptimeRows as Record<string, unknown>[])[0]?.['Value'];

    return {
      version: versionStr,
      productName: versionStr.toLowerCase().includes('mariadb') ? 'MariaDB' : 'MySQL',
      charset: charset ? String(charset) : undefined,
      uptime: uptime ? Number(uptime) : undefined,
    };
  }

  dispose(): void {
    void this.disconnect();
  }
}
