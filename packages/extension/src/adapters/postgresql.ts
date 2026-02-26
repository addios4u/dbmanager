import type { ConnectionConfig, QueryResult, TableInfo, ColumnInfo, IndexInfo, ForeignKeyInfo, ServerInfo } from '@dbmanager/shared';
import type { DatabaseAdapter } from './base.js';

export class PostgresqlAdapter implements DatabaseAdapter {
  private pool: import('pg').Pool | undefined;
  private queryCounter = 0;

  constructor(
    private readonly config: ConnectionConfig,
    private readonly password?: string,
    private readonly connectHost?: string,
    private readonly connectPort?: number,
  ) {}

  async connect(): Promise<void> {
    const { Pool } = await import('pg');
    this.pool = new Pool({
      host: this.connectHost ?? this.config.host ?? 'localhost',
      port: this.connectPort ?? this.config.port ?? 5432,
      user: this.config.username || undefined,
      password: this.password || undefined,
      database: this.config.database || undefined,
      max: 5,
      connectionTimeoutMillis: 10000,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
    });
    // Verify connection
    const client = await this.pool.connect();
    client.release();
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
    const queryId = `pg-${++this.queryCounter}`;
    const start = Date.now();
    const result = await this.pool.query(sql, params);

    const columns = result.fields?.map((f) => ({
      name: f.name,
      type: String(f.dataTypeID),
      nullable: true,
    })) ?? [];

    return {
      columns,
      rows: result.rows as Record<string, unknown>[],
      affectedRows: result.command !== 'SELECT' ? result.rowCount ?? undefined : undefined,
      executionTime: Date.now() - start,
      queryId,
    };
  }

  async cancel(_queryId: string): Promise<void> {
    // PostgreSQL cancel would require pg_cancel_backend
  }

  async getDatabases(): Promise<string[]> {
    if (!this.pool) throw new Error('Not connected');
    const result = await this.pool.query(
      `SELECT datname FROM pg_database
       WHERE datistemplate = false
       ORDER BY datname`,
    );
    return result.rows.map((r: Record<string, unknown>) => String(r['datname']));
  }

  async getSchemas(): Promise<string[]> {
    if (!this.pool) throw new Error('Not connected');
    const result = await this.pool.query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT LIKE 'pg_%'
         AND schema_name != 'information_schema'
       ORDER BY schema_name`,
    );
    return result.rows.map((r: Record<string, unknown>) => String(r['schema_name']));
  }

  async getTables(schema?: string): Promise<TableInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const s = schema ?? 'public';

    const result = await this.pool.query(
      `SELECT t.table_name, t.table_type,
              (SELECT reltuples::bigint FROM pg_class
               WHERE relname = t.table_name AND relnamespace = (
                 SELECT oid FROM pg_namespace WHERE nspname = t.table_schema
               )) AS row_count
       FROM information_schema.tables t
       WHERE t.table_schema = $1
       ORDER BY t.table_name`,
      [s],
    );

    return result.rows.map((r: Record<string, unknown>): TableInfo => ({
      name: String(r['table_name']),
      schema: s,
      type: String(r['table_type']) === 'VIEW' ? 'view' : 'table',
      rowCount: r['row_count'] != null && Number(r['row_count']) >= 0
        ? Number(r['row_count'])
        : undefined,
    }));
  }

  async getColumns(table: string, schema?: string): Promise<ColumnInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const s = schema ?? 'public';

    const result = await this.pool.query(
      `SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable,
              c.column_default, c.character_maximum_length,
              CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key,
              pgd.description AS column_comment
       FROM information_schema.columns c
       LEFT JOIN (
         SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_schema = $1 AND tc.table_name = $2
       ) pk ON c.column_name = pk.column_name
       LEFT JOIN pg_catalog.pg_statio_all_tables st
         ON st.schemaname = c.table_schema AND st.relname = c.table_name
       LEFT JOIN pg_catalog.pg_description pgd
         ON pgd.objoid = st.relid
         AND pgd.objsubid = c.ordinal_position
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
      [s, table],
    );

    return result.rows.map((r: Record<string, unknown>): ColumnInfo => {
      let typeName = String(r['data_type']);
      if (typeName === 'USER-DEFINED') {
        typeName = String(r['udt_name']);
      }
      if (r['character_maximum_length']) {
        typeName += `(${r['character_maximum_length']})`;
      }

      const colDefault = r['column_default'] != null ? String(r['column_default']) : null;
      const isAutoIncrement = colDefault?.startsWith('nextval(') ?? false;

      return {
        name: String(r['column_name']),
        type: typeName,
        nullable: String(r['is_nullable']) === 'YES',
        defaultValue: colDefault,
        isPrimaryKey: r['is_primary_key'] === true,
        isAutoIncrement,
        comment: r['column_comment'] ? String(r['column_comment']) : undefined,
      };
    });
  }

  async getIndexes(table: string, schema?: string): Promise<IndexInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const s = schema ?? 'public';

    const result = await this.pool.query(
      `SELECT i.relname AS index_name,
              ix.indisunique AS is_unique,
              ix.indisprimary AS is_primary,
              am.amname AS index_type,
              array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_am am ON am.oid = i.relam
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
       WHERE n.nspname = $1 AND t.relname = $2
       GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname
       ORDER BY i.relname`,
      [s, table],
    );

    return result.rows.map((r: Record<string, unknown>): IndexInfo => ({
      name: String(r['index_name']),
      columns: r['columns'] as string[],
      isUnique: r['is_unique'] === true,
      isPrimary: r['is_primary'] === true,
      type: String(r['index_type']),
    }));
  }

  async getForeignKeys(table: string, schema?: string): Promise<ForeignKeyInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const s = schema ?? 'public';

    const result = await this.pool.query(
      `SELECT tc.constraint_name,
              kcu.column_name,
              ccu.table_name AS referenced_table,
              ccu.column_name AS referenced_column,
              rc.delete_rule,
              rc.update_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name
         AND rc.constraint_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = $1 AND tc.table_name = $2`,
      [s, table],
    );

    return result.rows.map((r: Record<string, unknown>): ForeignKeyInfo => ({
      name: String(r['constraint_name']),
      column: String(r['column_name']),
      referencedTable: String(r['referenced_table']),
      referencedColumn: String(r['referenced_column']),
      onDelete: String(r['delete_rule']),
      onUpdate: String(r['update_rule']),
    }));
  }

  async getPrimaryKey(table: string, schema?: string): Promise<string[]> {
    const indexes = await this.getIndexes(table, schema);
    const pk = indexes.find((idx) => idx.isPrimary);
    return pk?.columns ?? [];
  }

  async getTableDDL(table: string, schema?: string): Promise<string> {
    if (!this.pool) throw new Error('Not connected');
    const s = schema ?? 'public';

    // PostgreSQL has no SHOW CREATE TABLE — build DDL from metadata
    const [columns, indexes, fks] = await Promise.all([
      this.getColumns(table, s),
      this.getIndexes(table, s),
      this.getForeignKeys(table, s),
    ]);

    const colDefs = columns.map((c) => {
      let def = `  "${c.name}" ${c.type}`;
      if (!c.nullable) def += ' NOT NULL';
      if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
      return def;
    });

    const pk = indexes.find((i) => i.isPrimary);
    if (pk) {
      colDefs.push(`  PRIMARY KEY (${pk.columns.map((c) => `"${c}"`).join(', ')})`);
    }

    for (const fk of fks) {
      colDefs.push(
        `  CONSTRAINT "${fk.name}" FOREIGN KEY ("${fk.column}") ` +
        `REFERENCES "${fk.referencedTable}" ("${fk.referencedColumn}") ` +
        `ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`,
      );
    }

    let ddl = `CREATE TABLE "${s}"."${table}" (\n${colDefs.join(',\n')}\n);`;

    // Add non-primary indexes
    for (const idx of indexes) {
      if (idx.isPrimary) continue;
      const unique = idx.isUnique ? 'UNIQUE ' : '';
      ddl += `\n\nCREATE ${unique}INDEX "${idx.name}" ON "${s}"."${table}" (${idx.columns.map((c) => `"${c}"`).join(', ')});`;
    }

    return ddl;
  }

  async getServerInfo(): Promise<ServerInfo> {
    if (!this.pool) throw new Error('Not connected');

    const [versionResult, encodingResult] = await Promise.all([
      this.pool.query('SELECT version()'),
      this.pool.query('SHOW server_encoding'),
    ]);

    const fullVersion = String(versionResult.rows[0]?.['version'] ?? '');
    // Extract short version like "16.1" from "PostgreSQL 16.1 (Debian ...)"
    const match = fullVersion.match(/PostgreSQL\s+([\d.]+)/);
    const version = match?.[1] ?? fullVersion;
    const encoding = String(encodingResult.rows[0]?.['server_encoding'] ?? '');

    return {
      version,
      productName: 'PostgreSQL',
      charset: encoding || undefined,
    };
  }

  dispose(): void {
    void this.disconnect();
  }
}
