import * as vscode from 'vscode';
import { readFileSync } from 'fs';
import { open as fsOpen } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import * as path from 'path';
import type { WebviewMessage, ExtensionMessage, ConnectionConfig, PanelMeta, TableEdit, ExportOptions, ColumnMeta } from '@dbmanager/shared';
import { PAGE_SIZE } from '@dbmanager/shared';
import type { ConnectionManager } from '../services/connection-manager.js';
import type { DatabaseAdapter, RedisAdapter } from '../adapters/base.js';
import { testConnection, testSshTunnel } from '../services/connection-tester.js';

/** DB 드라이버 에러에서 유용한 메시지를 추출한다. */
function formatError(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err) || 'Unknown error';
  }
  const e = err as unknown as Record<string, unknown>;
  const parts: string[] = [];

  // 메시지 본문: message → sqlMessage (mysql2) 순서로 폴백
  const msg = err.message || (typeof e['sqlMessage'] === 'string' ? e['sqlMessage'] : '');
  if (msg) {
    parts.push(msg);
  }

  // 에러 코드 (ECONNREFUSED, 28P01, ER_ACCESS_DENIED 등)
  if (typeof e['code'] === 'string') {
    parts.push(`[${e['code']}]`);
  }

  // 시스템 에러: address:port 정보
  if (typeof e['address'] === 'string') {
    const addr = e['port'] ? `${e['address']}:${e['port']}` : e['address'];
    parts.push(`(${addr})`);
  }

  // pg 에러: detail
  if (typeof e['detail'] === 'string') {
    parts.push(e['detail']);
  }

  return parts.join(' ') || 'Unknown error';
}

/** Quote an identifier for the given DB type. */
function quoteIdentifier(name: string, dbType: string): string {
  if (dbType === 'mysql' || dbType === 'mariadb') {
    return '`' + name.replace(/`/g, '``') + '`';
  }
  // postgresql, sqlite
  return '"' + name.replace(/"/g, '""') + '"';
}

export class WebviewPanelManager {
  readonly context: vscode.ExtensionContext;
  readonly connectionManager: ConnectionManager;
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(context: vscode.ExtensionContext, connectionManager: ConnectionManager) {
    this.context = context;
    this.connectionManager = connectionManager;
  }

  openQueryEditor(connectionId: string, database?: string, schema?: string): void {
    const key = `query:${connectionId}`;
    this.showOrCreate(key, vscode.l10n.t('Query — {0}', this.getConnectionLabel(connectionId)), { kind: 'query', connectionId, database, schema });
  }

  openQueryEditorWithSql(connectionId: string, sql: string, fileName?: string): void {
    const label = fileName ?? 'SQL';
    const key = `query:${connectionId}:${fileName ?? ''}`;
    this.showOrCreate(key, vscode.l10n.t('{0} — {1}', label, this.getConnectionLabel(connectionId)), {
      kind: 'query',
      connectionId,
      initialSql: sql,
    });
  }

  openTableData(connectionId: string, tableName: string, schema?: string, database?: string): void {
    const key = `tableData:${connectionId}:${database ?? ''}:${schema ?? ''}:${tableName}`;
    this.showOrCreate(key, vscode.l10n.t('{0} — Data', tableName), { kind: 'tableData', connectionId, tableName, schema, database });
  }

  openConnectionDialog(editId?: string): void {
    const key = editId ? `connectionDialog:${editId}` : 'connectionDialog:new';
    const title = editId ? vscode.l10n.t('Edit Connection') : vscode.l10n.t('New Connection');
    this.showOrCreate(key, title, { kind: 'connectionDialog', editId });
  }

  showDDL(connectionId: string, tableName: string, schema?: string, database?: string): void {
    const key = `ddl:${connectionId}:${database ?? ''}:${schema ?? ''}:${tableName}`;
    this.showOrCreate(key, vscode.l10n.t('{0} — DDL', tableName), { kind: 'ddl', connectionId, tableName, schema, database });
  }

  exportTable(connectionId: string, tableName: string, schema?: string, database?: string): void {
    const key = `export:${connectionId}:${database ?? ''}:${schema ?? ''}:${tableName}`;
    this.showOrCreate(key, vscode.l10n.t('{0} — Export', tableName), { kind: 'export', connectionId, tableName, schema, database });
  }

  openRedisBrowser(connectionId: string, db?: number): void {
    const key = `redis:${connectionId}:${db ?? 0}`;
    const label = this.getConnectionLabel(connectionId);
    const title = db !== undefined ? vscode.l10n.t('{0} — DB {1}', label, String(db)) : vscode.l10n.t('{0} — Redis', label);
    this.showOrCreate(key, title, { kind: 'redis', connectionId, redisDb: db });
  }

  private getConnectionLabel(connectionId: string): string {
    return this.connectionManager.getConnection(connectionId)?.name ?? connectionId;
  }

  private showOrCreate(key: string, title: string, meta: PanelMeta): void {
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'dbmanager',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        ],
      },
    );

    const nonce = this.getNonce();
    panel.webview.html = this.getWebviewContent(panel.webview, nonce, meta);

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(panel, meta, msg),
      undefined,
      this.context.subscriptions,
    );

    panel.onDidDispose(() => {
      this.panels.delete(key);
    });

    this.panels.set(key, panel);
  }

  /** Route a WebviewMessage to the appropriate handler. Public for reuse by SqlEditorProvider. */
  handleMessage(panel: vscode.WebviewPanel, meta: PanelMeta, msg: WebviewMessage): void {
    switch (msg.type) {
      case 'ready': {
        // Send initial state snapshot
        const connections = this.connectionManager.getConnectionInfos();
        const syncMsg: ExtensionMessage = {
          type: 'stateSync',
          connections,
          activeConnectionId: meta.connectionId,
        };
        void panel.webview.postMessage(syncMsg);

        // Auto-load content based on panel kind
        if (meta.kind === 'tableData' || meta.kind === 'tableEditor') {
          if (meta.connectionId && meta.tableName) {
            void this.handleGetTableData(panel, meta.connectionId, meta.tableName, meta.schema, 0, PAGE_SIZE);
          }
        } else if (meta.kind === 'ddl') {
          if (meta.connectionId && meta.tableName) {
            void this.handleGetTableDDL(panel, meta.connectionId, meta.tableName, meta.schema);
          }
        } else if (meta.kind === 'redis') {
          if (meta.connectionId) {
            void this.handleRedisScan(panel, meta.connectionId, '*', '0', 200, meta.redisDb);
          }
        } else if (meta.kind === 'query') {
          if (meta.connectionId) {
            // Pre-load database list
            void this.handleGetDatabases(panel, meta.connectionId);
            // Switch context and load schemas if database/schema are specified
            if (meta.database || meta.schema) {
              void this.handleSwitchQueryContext(panel, meta, meta.connectionId, meta.database, meta.schema).then(() => {
                if (meta.database && meta.schema) {
                  void this.handleGetSchemas(panel, meta.connectionId!, meta.database);
                }
              });
            }
          }
        }
        break;
      }

      case 'executeQuery': {
        void this.handleExecuteQuery(panel, msg.connectionId, msg.sql, meta);
        break;
      }

      case 'cancelQuery': {
        void this.handleCancelQuery(msg.queryId, meta.connectionId);
        break;
      }

      case 'testConnection': {
        void this.handleTestConnection(panel, msg.config, msg.password, msg.sshPassword, msg.sshPassphrase);
        break;
      }

      case 'testSshTunnel': {
        void this.handleTestSshTunnel(panel, msg.config, msg.sshPassword, msg.sshPassphrase);
        break;
      }

      case 'saveConnection': {
        void this.handleSaveConnection(panel, msg.config, msg.password, msg.sshPassword, msg.sshPassphrase);
        break;
      }

      case 'deleteConnection': {
        void this.connectionManager.deleteConnection(msg.connectionId);
        break;
      }

      case 'connect': {
        void this.connectionManager.connect(msg.connectionId);
        break;
      }

      case 'disconnect': {
        void this.connectionManager.disconnect(msg.connectionId);
        break;
      }

      case 'getTableData': {
        void this.handleGetTableData(
          panel,
          msg.connectionId,
          msg.table,
          msg.schema,
          msg.offset ?? 0,
          msg.limit ?? PAGE_SIZE,
          msg.sortColumn,
          msg.sortDirection,
          msg.where,
        );
        break;
      }

      case 'fetchPage': {
        // Re-use table meta from the panel
        if (meta.connectionId && meta.tableName) {
          void this.handleGetTableData(
            panel,
            meta.connectionId,
            meta.tableName,
            meta.schema,
            msg.offset,
            msg.limit,
          );
        }
        break;
      }

      case 'getTableDDL': {
        void this.handleGetTableDDL(panel, msg.connectionId, msg.table, msg.schema);
        break;
      }

      case 'saveTableEdits': {
        void this.handleSaveTableEdits(panel, msg.connectionId, msg.edits);
        break;
      }

      case 'exportData': {
        void this.handleExportData(panel, msg.connectionId, msg.table, msg.schema, msg.format, msg.options);
        break;
      }

      case 'exportTableData': {
        void this.handleExportTableData(panel, msg.connectionId, msg.table, msg.schema, msg.format, msg.where, msg.sortColumn, msg.sortDirection);
        break;
      }

      case 'importData': {
        void this.handleImportData(panel, msg.connectionId, msg.table, msg.schema);
        break;
      }

      case 'redisScan': {
        void this.handleRedisScan(panel, msg.connectionId, msg.pattern, msg.cursor, msg.count ?? 200, msg.db);
        break;
      }

      case 'redisGet': {
        void this.handleRedisGet(panel, msg.connectionId, msg.key);
        break;
      }

      case 'redisSet': {
        void this.handleRedisSet(panel, msg.connectionId, msg.key, msg.value, msg.ttl);
        break;
      }

      case 'redisDel': {
        void this.handleRedisDel(panel, msg.connectionId, msg.keys);
        break;
      }

      case 'redisSelectDb': {
        void this.handleRedisSelectDb(panel, msg.connectionId, msg.db);
        break;
      }

      case 'redisAddKey': {
        void this.handleRedisSet(panel, msg.connectionId, msg.key, msg.value, msg.ttl);
        break;
      }

      case 'browseFile': {
        void this.handleBrowseFile(panel, msg.target);
        break;
      }

      case 'exportQueryResults': {
        void this.handleExportQueryResults(panel, msg.format, msg.content, msg.defaultFileName);
        break;
      }

      case 'exportQueryResultsXlsx': {
        void this.handleExportQueryResultsXlsx(panel, msg.columns, msg.rows, msg.defaultFileName);
        break;
      }

      case 'getDatabases': {
        void this.handleGetDatabases(panel, msg.connectionId);
        break;
      }

      case 'getSchemas': {
        void this.handleGetSchemas(panel, msg.connectionId, msg.database);
        break;
      }

      case 'switchQueryContext': {
        void this.handleSwitchQueryContext(panel, meta, msg.connectionId, msg.database, msg.schema);
        break;
      }

      case 'documentChange': {
        // Handled by SqlEditorProvider — no-op in regular panels
        break;
      }

      case 'saveQueryToFile': {
        void this.handleSaveQueryToFile(msg.content);
        break;
      }

      case 'openExternal': {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
      }

      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Query handlers
  // ---------------------------------------------------------------------------

  /** Try to get a connected DatabaseAdapter, auto-reconnecting if needed. */
  private async ensureConnected(connectionId: string): Promise<DatabaseAdapter | null> {
    let adapter = this.connectionManager.getAdapter(connectionId);
    if (adapter && 'execute' in adapter) {
      return adapter as DatabaseAdapter;
    }

    // Adapter missing — attempt auto-reconnect
    const config = this.connectionManager.getConnection(connectionId);
    if (!config) return null;

    try {
      await this.connectionManager.connect(connectionId);
      adapter = this.connectionManager.getAdapter(connectionId);
      if (adapter && 'execute' in adapter) {
        return adapter as DatabaseAdapter;
      }
    } catch {
      // reconnect failed
    }
    return null;
  }

  private async handleGetDatabases(panel: vscode.WebviewPanel, connectionId: string): Promise<void> {
    const dbAdapter = await this.ensureConnected(connectionId);
    if (!dbAdapter) return;
    try {
      const databases = await dbAdapter.getDatabases();
      const msg: ExtensionMessage = { type: 'databaseList', connectionId, databases };
      void panel.webview.postMessage(msg);
    } catch {
      // silently ignore
    }
  }

  private async handleGetSchemas(panel: vscode.WebviewPanel, connectionId: string, database?: string): Promise<void> {
    const dbAdapter = await this.ensureConnected(connectionId);
    if (!dbAdapter) return;
    try {
      const schemas = await dbAdapter.getSchemas();
      const msg: ExtensionMessage = { type: 'schemaList', connectionId, schemas };
      void panel.webview.postMessage(msg);
    } catch {
      // silently ignore
    }
  }

  private async handleSwitchQueryContext(
    panel: vscode.WebviewPanel,
    meta: PanelMeta,
    connectionId: string,
    database?: string,
    schema?: string,
  ): Promise<void> {
    const dbAdapter = await this.ensureConnected(connectionId);
    if (!dbAdapter) {
      const errMsg: ExtensionMessage = { type: 'error', message: 'Failed to connect to database.' };
      void panel.webview.postMessage(errMsg);
      return;
    }

    const config = this.connectionManager.getConnection(connectionId);
    const dbType = config?.type;

    try {
      if (database) {
        if (dbType === 'mysql' || dbType === 'mariadb') {
          await dbAdapter.execute(`USE ${quoteIdentifier(database, dbType)}`);
        } else if (dbType === 'postgresql') {
          // PostgreSQL adapter has switchDatabase method
          const pgAdapter = dbAdapter as DatabaseAdapter & { switchDatabase?(db: string): Promise<void> };
          if (pgAdapter.switchDatabase) {
            await pgAdapter.switchDatabase(database);
          }
        }
        // SQLite: no database switching needed
      }

      if (schema && dbType === 'postgresql') {
        await dbAdapter.execute(`SET search_path TO ${quoteIdentifier(schema, dbType)}`);
      }

      // Update meta so subsequent queries use new context
      meta.database = database;
      meta.schema = schema;
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'error', message: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  private async handleExecuteQuery(
    panel: vscode.WebviewPanel,
    connectionId: string,
    sql: string,
    meta?: PanelMeta,
  ): Promise<void> {
    const dbAdapter = await this.ensureConnected(connectionId);
    if (!dbAdapter) {
      const errMsg: ExtensionMessage = {
        type: 'queryError',
        queryId: sql,
        error: 'Failed to connect to database. Please check connection settings.',
      };
      void panel.webview.postMessage(errMsg);
      return;
    }

    // Restore database context (tree browsing may have switched the adapter's pool)
    if (meta?.database) {
      const config = this.connectionManager.getConnection(connectionId);
      if (config?.type === 'postgresql') {
        const pgAdapter = dbAdapter as DatabaseAdapter & { switchDatabase?(db: string): Promise<void> };
        if (pgAdapter.switchDatabase) {
          await pgAdapter.switchDatabase(meta.database);
        }
      } else if (config?.type === 'mysql' || config?.type === 'mariadb') {
        await dbAdapter.execute(`USE ${quoteIdentifier(meta.database, config.type)}`);
      }
      if (meta.schema && config?.type === 'postgresql') {
        await dbAdapter.execute(`SET search_path TO ${quoteIdentifier(meta.schema, config.type)}`);
      }
    }

    try {
      const result = await dbAdapter.execute(sql);
      const resultMsg: ExtensionMessage = {
        type: 'queryResult',
        queryId: result.queryId,
        columns: result.columns,
        rows: result.rows,
        totalRows: result.rows.length,
        executionTime: result.executionTime,
      };
      void panel.webview.postMessage(resultMsg);
    } catch (err) {
      const errMsg: ExtensionMessage = {
        type: 'queryError',
        queryId: sql,
        error: formatError(err),
      };
      void panel.webview.postMessage(errMsg);
    }
  }

  private async handleCancelQuery(queryId: string, connectionId?: string): Promise<void> {
    if (!connectionId) return;
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (adapter && 'cancel' in adapter) {
      try {
        await (adapter as DatabaseAdapter).cancel(queryId);
      } catch {
        // ignore cancel errors
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Table data handlers
  // ---------------------------------------------------------------------------

  private async handleGetTableData(
    panel: vscode.WebviewPanel,
    connectionId: string,
    table: string,
    schema: string | undefined,
    offset: number,
    limit: number,
    sortColumn?: string,
    sortDirection?: 'asc' | 'desc',
    where?: string,
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (!adapter || !('execute' in adapter)) {
      const errMsg: ExtensionMessage = { type: 'error', message: 'No active database connection' };
      void panel.webview.postMessage(errMsg);
      return;
    }
    const dbAdapter = adapter as DatabaseAdapter;
    const config = this.connectionManager.getConnection(connectionId);
    if (!config) {
      const errMsg: ExtensionMessage = { type: 'error', message: 'Connection config not found' };
      void panel.webview.postMessage(errMsg);
      return;
    }

    const dbType = config.type;
    const isPostgres = dbType === 'postgresql';

    // Build qualified table name
    const qualTable = schema
      ? `${quoteIdentifier(schema, dbType)}.${quoteIdentifier(table, dbType)}`
      : quoteIdentifier(table, dbType);

    // WHERE clause (user-provided condition)
    const whereClause = where?.trim() ? ` WHERE ${where.trim()}` : '';

    // ORDER BY clause
    let orderClause = '';
    if (sortColumn) {
      const dir = sortDirection === 'desc' ? 'DESC' : 'ASC';
      orderClause = ` ORDER BY ${quoteIdentifier(sortColumn, dbType)} ${dir}`;
    }

    try {
      let countSql: string;
      let dataSql: string;
      let dataParams: unknown[];

      if (isPostgres) {
        countSql = `SELECT COUNT(*) AS cnt FROM ${qualTable}${whereClause}`;
        dataSql = `SELECT * FROM ${qualTable}${whereClause}${orderClause} LIMIT $1 OFFSET $2`;
        dataParams = [limit, offset];
      } else {
        countSql = `SELECT COUNT(*) AS cnt FROM ${qualTable}${whereClause}`;
        dataSql = `SELECT * FROM ${qualTable}${whereClause}${orderClause} LIMIT ? OFFSET ?`;
        dataParams = [limit, offset];
      }

      const [countResult, dataResult, columnsMeta, primaryKeys] = await Promise.all([
        dbAdapter.execute(countSql),
        dbAdapter.execute(dataSql, dataParams),
        dbAdapter.getColumns(table, schema),
        dbAdapter.getPrimaryKey(table, schema),
      ]);

      // Extract total count — different drivers return it differently
      const firstRow = countResult.rows[0];
      let totalRows = 0;
      if (firstRow) {
        const val = firstRow['cnt'] ?? firstRow['count(*)'] ?? firstRow['COUNT(*)'] ?? firstRow['count'];
        totalRows = typeof val === 'number' ? val : parseInt(String(val), 10) || 0;
      }

      // Use getColumns() for readable type names (execute() returns numeric type IDs)
      const columns = columnsMeta.length > 0
        ? columnsMeta.map((c) => ({ name: c.name, type: c.type, nullable: c.nullable }))
        : dataResult.columns;

      const tableDataMsg: ExtensionMessage = {
        type: 'tableData',
        connectionId,
        table,
        columns,
        rows: dataResult.rows,
        totalRows,
        offset,
        primaryKeys,
      };
      void panel.webview.postMessage(tableDataMsg);
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'error', message: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  private async handleGetTableDDL(
    panel: vscode.WebviewPanel,
    connectionId: string,
    table: string,
    schema?: string,
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (!adapter || !('getTableDDL' in adapter)) {
      const errMsg: ExtensionMessage = { type: 'error', message: 'No active database connection' };
      void panel.webview.postMessage(errMsg);
      return;
    }
    try {
      const ddl = await (adapter as DatabaseAdapter).getTableDDL(table, schema);
      const ddlMsg: ExtensionMessage = { type: 'tableDDL', connectionId, table, ddl };
      void panel.webview.postMessage(ddlMsg);
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'error', message: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  private async handleSaveTableEdits(
    panel: vscode.WebviewPanel,
    connectionId: string,
    edits: TableEdit[],
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (!adapter || !('execute' in adapter)) {
      const errMsg: ExtensionMessage = { type: 'editResult', success: false, error: 'No active database connection' };
      void panel.webview.postMessage(errMsg);
      return;
    }
    const dbAdapter = adapter as DatabaseAdapter;
    const config = this.connectionManager.getConnection(connectionId);
    if (!config) {
      const errMsg: ExtensionMessage = { type: 'editResult', success: false, error: 'Connection config not found' };
      void panel.webview.postMessage(errMsg);
      return;
    }

    const dbType = config.type;
    const isPostgres = dbType === 'postgresql';

    try {
      for (const edit of edits) {
        const qualTable = edit.schema
          ? `${quoteIdentifier(edit.schema, dbType)}.${quoteIdentifier(edit.table, dbType)}`
          : quoteIdentifier(edit.table, dbType);

        if (edit.type === 'insert') {
          const cols = Object.keys(edit.changes);
          const vals = Object.values(edit.changes);
          const colList = cols.map((c) => quoteIdentifier(c, dbType)).join(', ');
          let placeholders: string;
          if (isPostgres) {
            placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
          } else {
            placeholders = cols.map(() => '?').join(', ');
          }
          const sql = `INSERT INTO ${qualTable} (${colList}) VALUES (${placeholders})`;
          await dbAdapter.execute(sql, vals);
        } else if (edit.type === 'update') {
          const setCols = Object.keys(edit.changes);
          const setVals = Object.values(edit.changes);
          const pkCols = Object.keys(edit.primaryKey);
          const pkVals = Object.values(edit.primaryKey);
          let paramIdx = 1;
          let setClause: string;
          let whereClause: string;
          if (isPostgres) {
            setClause = setCols.map((c) => `${quoteIdentifier(c, dbType)} = $${paramIdx++}`).join(', ');
            whereClause = pkCols.map((c) => `${quoteIdentifier(c, dbType)} = $${paramIdx++}`).join(' AND ');
          } else {
            setClause = setCols.map((c) => `${quoteIdentifier(c, dbType)} = ?`).join(', ');
            whereClause = pkCols.map((c) => `${quoteIdentifier(c, dbType)} = ?`).join(' AND ');
          }
          const sql = `UPDATE ${qualTable} SET ${setClause} WHERE ${whereClause}`;
          await dbAdapter.execute(sql, [...setVals, ...pkVals]);
        } else if (edit.type === 'delete') {
          const pkCols = Object.keys(edit.primaryKey);
          const pkVals = Object.values(edit.primaryKey);
          let whereClause: string;
          if (isPostgres) {
            whereClause = pkCols.map((c, i) => `${quoteIdentifier(c, dbType)} = $${i + 1}`).join(' AND ');
          } else {
            whereClause = pkCols.map((c) => `${quoteIdentifier(c, dbType)} = ?`).join(' AND ');
          }
          const sql = `DELETE FROM ${qualTable} WHERE ${whereClause}`;
          await dbAdapter.execute(sql, pkVals);
        }
      }
      const resultMsg: ExtensionMessage = { type: 'editResult', success: true };
      void panel.webview.postMessage(resultMsg);
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'editResult', success: false, error: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  // ---------------------------------------------------------------------------
  // Export handler
  // ---------------------------------------------------------------------------

  private async handleExportData(
    panel: vscode.WebviewPanel,
    connectionId: string,
    table: string,
    schema: string | undefined,
    format: 'csv' | 'json' | 'sql',
    options?: ExportOptions,
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (!adapter || !('execute' in adapter)) {
      const errMsg: ExtensionMessage = { type: 'exportError', error: 'No active database connection' };
      void panel.webview.postMessage(errMsg);
      return;
    }
    const dbAdapter = adapter as DatabaseAdapter;
    const config = this.connectionManager.getConnection(connectionId);
    if (!config) {
      const errMsg: ExtensionMessage = { type: 'exportError', error: 'Connection config not found' };
      void panel.webview.postMessage(errMsg);
      return;
    }

    const filterMap: Record<string, { [label: string]: string[] }> = {
      csv: { [vscode.l10n.t('CSV Files')]: ['csv'] },
      json: { [vscode.l10n.t('JSON Files')]: ['json'] },
      sql: { [vscode.l10n.t('SQL Files')]: ['sql'] },
    };

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(require('os').homedir(), `${table}.${format}`)),
      filters: filterMap[format] ?? {},
      title: vscode.l10n.t('Export {0} as {1}', table, format.toUpperCase()),
    });

    if (!saveUri) {
      // User cancelled
      return;
    }

    const dbType = config.type;
    const isPostgres = dbType === 'postgresql';
    const qualTable = schema
      ? `${quoteIdentifier(schema, dbType)}.${quoteIdentifier(table, dbType)}`
      : quoteIdentifier(table, dbType);

    try {
      // Get total row count
      const countResult = await dbAdapter.execute(`SELECT COUNT(*) AS cnt FROM ${qualTable}`);
      const firstRow = countResult.rows[0];
      let totalRows = 0;
      if (firstRow) {
        const val = firstRow['cnt'] ?? firstRow['count(*)'] ?? firstRow['COUNT(*)'] ?? firstRow['count'];
        totalRows = typeof val === 'number' ? val : parseInt(String(val), 10) || 0;
      }

      const delimiter = options?.delimiter ?? ',';
      const includeHeaders = options?.includeHeaders !== false;
      const prettyPrint = options?.prettyPrint === true;
      const includeDropStatement = options?.includeDropStatement === true;

      let fileHandle: FileHandle | undefined;
      try {
        fileHandle = await fsOpen(saveUri.fsPath, 'w');

        let headers: string[] | undefined;
        const allRows: Record<string, unknown>[] = [];

        let offset = 0;
        while (offset < totalRows || (offset === 0 && totalRows === 0)) {
          let dataSql: string;
          let dataParams: unknown[];
          if (isPostgres) {
            dataSql = `SELECT * FROM ${qualTable} LIMIT $1 OFFSET $2`;
            dataParams = [PAGE_SIZE, offset];
          } else {
            dataSql = `SELECT * FROM ${qualTable} LIMIT ? OFFSET ?`;
            dataParams = [PAGE_SIZE, offset];
          }

          const dataResult = await dbAdapter.execute(dataSql, dataParams);

          if (!headers && dataResult.columns.length > 0) {
            headers = dataResult.columns.map((c) => c.name);
          }

          if (format === 'json') {
            allRows.push(...dataResult.rows);
          } else if (format === 'csv') {
            if (offset === 0 && includeHeaders && headers) {
              const headerLine = headers.map((h) => csvEscape(h, delimiter)).join(delimiter) + '\n';
              await fileHandle.write(headerLine);
            }
            for (const row of dataResult.rows) {
              const line = (headers ?? []).map((h) => csvEscape(String(row[h] ?? ''), delimiter)).join(delimiter) + '\n';
              await fileHandle.write(line);
            }
          } else if (format === 'sql') {
            if (offset === 0 && includeDropStatement) {
              await fileHandle.write(`DROP TABLE IF EXISTS ${qualTable};\n\n`);
            }
            for (const row of dataResult.rows) {
              const cols = (headers ?? []).map((h) => quoteIdentifier(h, dbType)).join(', ');
              const vals = (headers ?? []).map((h) => sqlValue(row[h])).join(', ');
              await fileHandle.write(`INSERT INTO ${qualTable} (${cols}) VALUES (${vals});\n`);
            }
          }

          const percent = Math.min(100, Math.round(((offset + dataResult.rows.length) / Math.max(totalRows, 1)) * 100));
          const progressMsg: ExtensionMessage = {
            type: 'exportProgress',
            percent,
            message: `Exported ${offset + dataResult.rows.length} / ${totalRows} rows`,
          };
          void panel.webview.postMessage(progressMsg);

          if (dataResult.rows.length < PAGE_SIZE) break;
          offset += PAGE_SIZE;
        }

        // Write JSON in one shot after collecting all rows
        if (format === 'json' && fileHandle) {
          const jsonStr = prettyPrint ? JSON.stringify(allRows, null, 2) : JSON.stringify(allRows);
          await fileHandle.write(jsonStr);
        }
      } finally {
        await fileHandle?.close();
      }

      const completeMsg: ExtensionMessage = { type: 'exportComplete', filePath: saveUri.fsPath };
      void panel.webview.postMessage(completeMsg);
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'exportError', error: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  // ---------------------------------------------------------------------------
  // Query results export handler
  // ---------------------------------------------------------------------------

  private async handleExportQueryResults(
    panel: vscode.WebviewPanel,
    format: 'csv' | 'json' | 'xml',
    content: string,
    defaultFileName: string,
  ): Promise<void> {
    const filterMap: Record<string, { [label: string]: string[] }> = {
      csv: { [vscode.l10n.t('CSV Files')]: ['csv'] },
      json: { [vscode.l10n.t('JSON Files')]: ['json'] },
      xml: { [vscode.l10n.t('XML Files')]: ['xml'] },
    };

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(require('os').homedir(), `${defaultFileName}.${format}`),
      ),
      filters: filterMap[format] ?? {},
      title: vscode.l10n.t('Export Query Results as {0}', format.toUpperCase()),
    });

    if (!saveUri) return;

    try {
      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf-8'));
      const completeMsg: ExtensionMessage = { type: 'exportComplete', filePath: saveUri.fsPath };
      void panel.webview.postMessage(completeMsg);
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'exportError', error: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  private async handleExportQueryResultsXlsx(
    panel: vscode.WebviewPanel,
    columns: ColumnMeta[],
    rows: Record<string, unknown>[],
    defaultFileName: string,
  ): Promise<void> {
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(require('os').homedir(), `${defaultFileName}.xlsx`),
      ),
      filters: { [vscode.l10n.t('Excel Files')]: ['xlsx'] },
      title: vscode.l10n.t('Export Query Results as Excel'),
    });

    if (!saveUri) return;

    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Query Results');

      worksheet.columns = columns.map((col) => ({
        header: col.name,
        key: col.name,
        width: Math.max(col.name.length + 2, 12),
      }));

      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
      };

      for (const row of rows) {
        const values: Record<string, unknown> = {};
        for (const col of columns) {
          const val = row[col.name];
          if (val !== null && val !== undefined && typeof val === 'object') {
            values[col.name] = JSON.stringify(val);
          } else {
            values[col.name] = val;
          }
        }
        worksheet.addRow(values);
      }

      if (columns.length > 0) {
        worksheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: 1, column: columns.length },
        };
      }

      const buffer = await workbook.xlsx.writeBuffer();
      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(buffer as ArrayBuffer));

      const completeMsg: ExtensionMessage = { type: 'exportComplete', filePath: saveUri.fsPath };
      void panel.webview.postMessage(completeMsg);
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'exportError', error: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  // ---------------------------------------------------------------------------
  // Table data export handler (streaming from DB with WHERE/ORDER BY)
  // ---------------------------------------------------------------------------

  private async handleExportTableData(
    panel: vscode.WebviewPanel,
    connectionId: string,
    table: string,
    schema: string | undefined,
    format: 'csv' | 'xlsx' | 'json' | 'xml',
    where?: string,
    sortColumn?: string,
    sortDirection?: 'asc' | 'desc',
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (!adapter || !('execute' in adapter)) {
      const errMsg: ExtensionMessage = { type: 'exportError', error: 'No active database connection' };
      void panel.webview.postMessage(errMsg);
      return;
    }
    const dbAdapter = adapter as DatabaseAdapter;
    const config = this.connectionManager.getConnection(connectionId);
    if (!config) {
      const errMsg: ExtensionMessage = { type: 'exportError', error: 'Connection config not found' };
      void panel.webview.postMessage(errMsg);
      return;
    }

    const filterMap: Record<string, { [label: string]: string[] }> = {
      csv: { [vscode.l10n.t('CSV Files')]: ['csv'] },
      xlsx: { [vscode.l10n.t('Excel Files')]: ['xlsx'] },
      json: { [vscode.l10n.t('JSON Files')]: ['json'] },
      xml: { [vscode.l10n.t('XML Files')]: ['xml'] },
    };

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(require('os').homedir(), `${table}.${format}`)),
      filters: filterMap[format] ?? {},
      title: vscode.l10n.t('Export {0} as {1}', table, format.toUpperCase()),
    });

    if (!saveUri) return;

    const dbType = config.type;
    const isPostgres = dbType === 'postgresql';
    const qualTable = schema
      ? `${quoteIdentifier(schema, dbType)}.${quoteIdentifier(table, dbType)}`
      : quoteIdentifier(table, dbType);

    // Build WHERE and ORDER BY clauses
    const wherePart = where ? ` WHERE ${where}` : '';
    const orderPart = sortColumn
      ? ` ORDER BY ${quoteIdentifier(sortColumn, dbType)} ${sortDirection === 'desc' ? 'DESC' : 'ASC'}`
      : '';

    try {
      // Get total row count
      const countResult = await dbAdapter.execute(`SELECT COUNT(*) AS cnt FROM ${qualTable}${wherePart}`);
      const firstRow = countResult.rows[0];
      let totalRows = 0;
      if (firstRow) {
        const val = firstRow['cnt'] ?? firstRow['count(*)'] ?? firstRow['COUNT(*)'] ?? firstRow['count'];
        totalRows = typeof val === 'number' ? val : parseInt(String(val), 10) || 0;
      }

      if (format === 'xlsx') {
        // XLSX: use ExcelJS with streaming adds
        const ExcelJS = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(table);

        let headersSet = false;
        let headers: string[] = [];
        let offset = 0;

        while (offset < totalRows || (offset === 0 && totalRows === 0)) {
          const dataSql = isPostgres
            ? `SELECT * FROM ${qualTable}${wherePart}${orderPart} LIMIT $1 OFFSET $2`
            : `SELECT * FROM ${qualTable}${wherePart}${orderPart} LIMIT ? OFFSET ?`;
          const dataResult = await dbAdapter.execute(dataSql, [PAGE_SIZE, offset]);

          if (!headersSet && dataResult.columns.length > 0) {
            headers = dataResult.columns.map((c) => c.name);
            worksheet.columns = headers.map((h) => ({
              header: h,
              key: h,
              width: Math.max(h.length + 2, 12),
            }));
            const headerRow = worksheet.getRow(1);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
            headersSet = true;
          }

          for (const row of dataResult.rows) {
            const values: Record<string, unknown> = {};
            for (const h of headers) {
              const val = row[h];
              values[h] = val !== null && val !== undefined && typeof val === 'object' ? JSON.stringify(val) : val;
            }
            worksheet.addRow(values);
          }

          const percent = Math.min(100, Math.round(((offset + dataResult.rows.length) / Math.max(totalRows, 1)) * 100));
          void panel.webview.postMessage({ type: 'exportProgress', percent, message: `${offset + dataResult.rows.length} / ${totalRows}` } as ExtensionMessage);

          if (dataResult.rows.length < PAGE_SIZE) break;
          offset += PAGE_SIZE;
        }

        if (headers.length > 0) {
          worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
        }

        const buffer = await workbook.xlsx.writeBuffer();
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(buffer as ArrayBuffer));
      } else {
        // CSV, JSON, XML: stream to file
        let fileHandle: FileHandle | undefined;
        try {
          fileHandle = await fsOpen(saveUri.fsPath, 'w');

          let headers: string[] | undefined;
          const allRows: Record<string, unknown>[] = [];
          let offset = 0;

          // XML header
          if (format === 'xml') {
            await fileHandle.write('<?xml version="1.0" encoding="UTF-8"?>\n<results>\n');
          }

          while (offset < totalRows || (offset === 0 && totalRows === 0)) {
            const dataSql = isPostgres
              ? `SELECT * FROM ${qualTable}${wherePart}${orderPart} LIMIT $1 OFFSET $2`
              : `SELECT * FROM ${qualTable}${wherePart}${orderPart} LIMIT ? OFFSET ?`;
            const dataResult = await dbAdapter.execute(dataSql, [PAGE_SIZE, offset]);

            if (!headers && dataResult.columns.length > 0) {
              headers = dataResult.columns.map((c) => c.name);
            }

            if (format === 'json') {
              allRows.push(...dataResult.rows);
            } else if (format === 'csv') {
              if (offset === 0 && headers) {
                const headerLine = headers.map((h) => csvEscape(h, ',')).join(',') + '\n';
                await fileHandle.write(headerLine);
              }
              for (const row of dataResult.rows) {
                const line = (headers ?? []).map((h) => csvEscape(String(row[h] ?? ''), ',')).join(',') + '\n';
                await fileHandle.write(line);
              }
            } else if (format === 'xml') {
              for (const row of dataResult.rows) {
                await fileHandle.write('  <row>\n');
                for (const h of (headers ?? [])) {
                  const value = row[h] === null || row[h] === undefined ? '' : typeof row[h] === 'object' ? JSON.stringify(row[h]) : String(row[h]);
                  const tag = xmlTagName(h);
                  await fileHandle.write(`    <${tag}>${xmlEscape(value)}</${tag}>\n`);
                }
                await fileHandle.write('  </row>\n');
              }
            }

            const percent = Math.min(100, Math.round(((offset + dataResult.rows.length) / Math.max(totalRows, 1)) * 100));
            void panel.webview.postMessage({ type: 'exportProgress', percent, message: `${offset + dataResult.rows.length} / ${totalRows}` } as ExtensionMessage);

            if (dataResult.rows.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
          }

          if (format === 'json' && fileHandle) {
            await fileHandle.write(JSON.stringify(allRows, null, 2));
          }
          if (format === 'xml') {
            await fileHandle.write('</results>\n');
          }
        } finally {
          await fileHandle?.close();
        }
      }

      const completeMsg: ExtensionMessage = { type: 'exportComplete', filePath: saveUri.fsPath };
      void panel.webview.postMessage(completeMsg);
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'exportError', error: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  // ---------------------------------------------------------------------------
  // Import handler
  // ---------------------------------------------------------------------------

  private async handleImportData(
    panel: vscode.WebviewPanel,
    connectionId: string,
    table: string,
    schema?: string,
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (!adapter || !('execute' in adapter)) {
      void panel.webview.postMessage({ type: 'importError', error: 'No active database connection' } as ExtensionMessage);
      return;
    }
    const dbAdapter = adapter as DatabaseAdapter;
    const config = this.connectionManager.getConnection(connectionId);
    if (!config) {
      void panel.webview.postMessage({ type: 'importError', error: 'Connection config not found' } as ExtensionMessage);
      return;
    }

    const fileUris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: {
        [vscode.l10n.t('Importable Files')]: ['xlsx', 'csv', 'json', 'xml'],
        [vscode.l10n.t('Excel Files')]: ['xlsx'],
        [vscode.l10n.t('CSV Files')]: ['csv'],
        [vscode.l10n.t('JSON Files')]: ['json'],
        [vscode.l10n.t('XML Files')]: ['xml'],
      },
      title: vscode.l10n.t('Import Data into {0}', table),
    });
    if (!fileUris || fileUris.length === 0) return;
    const pickedUri = fileUris[0];
    if (!pickedUri) return;

    const filePath = pickedUri.fsPath;
    const ext = path.extname(filePath).toLowerCase().slice(1);

    const dbType = config.type;
    const isPostgres = dbType === 'postgresql';
    const qualTable = schema
      ? `${quoteIdentifier(schema, dbType)}.${quoteIdentifier(table, dbType)}`
      : quoteIdentifier(table, dbType);

    try {
      // 1. Parse file into rows
      let parsedRows: Record<string, unknown>[];
      switch (ext) {
        case 'csv':
          parsedRows = this.parseCSV(filePath);
          break;
        case 'xlsx':
          parsedRows = await this.parseXLSX(filePath);
          break;
        case 'json':
          parsedRows = this.parseJSON(filePath);
          break;
        case 'xml':
          parsedRows = this.parseXML(filePath);
          break;
        default:
          throw new Error(vscode.l10n.t('Unsupported file format: .{0}', ext));
      }

      if (parsedRows.length === 0) {
        throw new Error(vscode.l10n.t('No data rows found in file.'));
      }

      // 2. Validate columns against table schema
      const tableColumns = await dbAdapter.getColumns(table, schema);
      const tableColNames = new Set(tableColumns.map((c) => c.name));
      const firstRow = parsedRows[0]!;
      const fileColNames = Object.keys(firstRow);
      const validColumns = fileColNames.filter((c) => tableColNames.has(c));

      if (validColumns.length === 0) {
        throw new Error(
          vscode.l10n.t('No matching columns found.') +
          ` File: ${fileColNames.join(', ')}. Table: ${tableColumns.map((c) => c.name).join(', ')}.`,
        );
      }

      // 3. Build INSERT template
      const colList = validColumns.map((c) => quoteIdentifier(c, dbType)).join(', ');
      let placeholders: string;
      if (isPostgres) {
        placeholders = validColumns.map((_, i) => `$${i + 1}`).join(', ');
      } else {
        placeholders = validColumns.map(() => '?').join(', ');
      }
      const insertSql = `INSERT INTO ${qualTable} (${colList}) VALUES (${placeholders})`;

      // 4. Insert rows in batches with progress
      const totalRows = parsedRows.length;
      let inserted = 0;

      for (const row of parsedRows) {
        const vals = validColumns.map((c) => {
          const v = row[c];
          if (v === undefined || v === '') return null;
          return v;
        });
        await dbAdapter.execute(insertSql, vals);
        inserted++;

        if (inserted % 100 === 0 || inserted === totalRows) {
          const percent = Math.min(100, Math.round((inserted / totalRows) * 100));
          void panel.webview.postMessage({
            type: 'importProgress',
            percent,
            message: `${inserted} / ${totalRows}`,
          } as ExtensionMessage);
        }
      }

      void panel.webview.postMessage({ type: 'importComplete', rowCount: inserted } as ExtensionMessage);
    } catch (err) {
      void panel.webview.postMessage({ type: 'importError', error: formatError(err) } as ExtensionMessage);
    }
  }

  // ---------------------------------------------------------------------------
  // File parsers for import
  // ---------------------------------------------------------------------------

  private parseCSV(filePath: string): Record<string, unknown>[] {
    const { parse } = require('csv-parse/sync') as { parse: (input: string, options: Record<string, unknown>) => Record<string, unknown>[] };
    const content = readFileSync(filePath, 'utf-8');
    return parse(content, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
    });
  }

  private async parseXLSX(filePath: string): Promise<Record<string, unknown>[]> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) return [];

    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value ?? `col${colNumber}`);
    });

    const rows: Record<string, unknown>[] = [];
    for (let r = 2; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const obj: Record<string, unknown> = {};
      let hasValue = false;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber - 1];
        if (header) {
          obj[header] = cell.value;
          if (cell.value !== null && cell.value !== undefined) hasValue = true;
        }
      });
      if (hasValue) rows.push(obj);
    }
    return rows;
  }

  private parseJSON(filePath: string): Record<string, unknown>[] {
    const content = readFileSync(filePath, 'utf-8');
    const data: unknown = JSON.parse(content);
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    throw new Error(vscode.l10n.t('JSON file must contain an array of objects.'));
  }

  private parseXML(filePath: string): Record<string, unknown>[] {
    const { XMLParser } = require('fast-xml-parser') as { XMLParser: new (opts: Record<string, unknown>) => { parse: (content: string) => Record<string, unknown> } };
    const content = readFileSync(filePath, 'utf-8');
    const parser = new XMLParser({ ignoreAttributes: true });
    const parsed = parser.parse(content);

    // Find the first array of objects in the parsed structure
    for (const key of Object.keys(parsed)) {
      const val = parsed[key];
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        for (const innerKey of Object.keys(val as Record<string, unknown>)) {
          const arr = (val as Record<string, unknown>)[innerKey];
          if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'object') {
            return arr as Record<string, unknown>[];
          }
        }
      }
    }
    throw new Error(vscode.l10n.t('XML file must contain repeating row elements.'));
  }

  private async handleSaveQueryToFile(content: string): Promise<void> {
    const saveUri = await vscode.window.showSaveDialog({
      filters: { [vscode.l10n.t('SQL Files')]: ['sql'] },
      title: vscode.l10n.t('Save Query'),
    });
    if (!saveUri) return;
    await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf-8'));
  }

  // ---------------------------------------------------------------------------
  // Redis handlers
  // ---------------------------------------------------------------------------

  private async handleRedisScan(
    panel: vscode.WebviewPanel,
    connectionId: string,
    pattern: string,
    cursor: string,
    count: number,
    db?: number,
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (!adapter || !('scan' in adapter)) {
      const errMsg: ExtensionMessage = { type: 'error', message: 'No active Redis connection' };
      void panel.webview.postMessage(errMsg);
      return;
    }
    const redisAdapter = adapter as RedisAdapter;
    try {
      const scanResult = await redisAdapter.scan(pattern, cursor, count);

      // Fetch type and ttl for each key in parallel (batched)
      const keyInfos = await Promise.all(
        scanResult.keys.map(async (key) => {
          const [type, ttl] = await Promise.all([
            redisAdapter.type(key),
            redisAdapter.ttl(key),
          ]);
          return { key, type, ttl };
        }),
      );

      const keysMsg: ExtensionMessage = {
        type: 'redisKeys',
        connectionId,
        keys: keyInfos,
        cursor: scanResult.cursor,
        hasMore: scanResult.hasMore,
      };
      void panel.webview.postMessage(keysMsg);
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'error', message: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  private async handleRedisGet(
    panel: vscode.WebviewPanel,
    connectionId: string,
    key: string,
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (!adapter || !('get' in adapter)) {
      const errMsg: ExtensionMessage = { type: 'error', message: 'No active Redis connection' };
      void panel.webview.postMessage(errMsg);
      return;
    }
    try {
      const value = await (adapter as RedisAdapter).get(key);
      const valueMsg: ExtensionMessage = { type: 'redisValue', connectionId, value };
      void panel.webview.postMessage(valueMsg);
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'error', message: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  private async handleRedisSet(
    panel: vscode.WebviewPanel,
    connectionId: string,
    key: string,
    value: string,
    ttl?: number,
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (!adapter || !('set' in adapter)) {
      const errMsg: ExtensionMessage = { type: 'error', message: 'No active Redis connection' };
      void panel.webview.postMessage(errMsg);
      return;
    }
    try {
      await (adapter as RedisAdapter).set(key, value, ttl);
      // Re-scan after set to refresh keys view
      void this.handleRedisScan(panel, connectionId, '*', '0', 200);
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'error', message: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  private async handleRedisDel(
    panel: vscode.WebviewPanel,
    connectionId: string,
    keys: string[],
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (!adapter || !('del' in adapter)) {
      const errMsg: ExtensionMessage = { type: 'error', message: 'No active Redis connection' };
      void panel.webview.postMessage(errMsg);
      return;
    }
    try {
      await (adapter as RedisAdapter).del(keys);
      // Re-scan after deletion to refresh keys view
      void this.handleRedisScan(panel, connectionId, '*', '0', 200);
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'error', message: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  private async handleRedisSelectDb(
    panel: vscode.WebviewPanel,
    connectionId: string,
    db: number,
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId);
    if (!adapter || !('selectDb' in adapter)) {
      const errMsg: ExtensionMessage = { type: 'error', message: 'No active Redis connection' };
      void panel.webview.postMessage(errMsg);
      return;
    }
    try {
      await (adapter as RedisAdapter).selectDb(db);
      void this.handleRedisScan(panel, connectionId, '*', '0', 200, db);
    } catch (err) {
      const errMsg: ExtensionMessage = { type: 'error', message: formatError(err) };
      void panel.webview.postMessage(errMsg);
    }
  }

  // ---------------------------------------------------------------------------
  // Connection test / save handlers
  // ---------------------------------------------------------------------------

  private async handleTestConnection(
    panel: vscode.WebviewPanel,
    config: ConnectionConfig,
    password?: string,
    sshPassword?: string,
    sshPassphrase?: string,
  ): Promise<void> {
    try {
      // 기존 커넥션 편집 시 비밀번호 미입력이면 저장된 비밀번호로 폴백
      const effectivePassword = password ?? await this.connectionManager.getPassword(config.id);
      const effectiveSshPassword = sshPassword ?? await this.connectionManager.getSshPassword(config.id);
      const effectiveSshPassphrase = sshPassphrase ?? await this.connectionManager.getSshPassphrase(config.id);
      await testConnection(config, effectivePassword, effectiveSshPassword, effectiveSshPassphrase);
      const resultMsg: ExtensionMessage = {
        type: 'connectionTestResult',
        success: true,
      };
      void panel.webview.postMessage(resultMsg);
    } catch (err) {
      const resultMsg: ExtensionMessage = {
        type: 'connectionTestResult',
        success: false,
        error: formatError(err),
      };
      void panel.webview.postMessage(resultMsg);
    }
  }

  private async handleTestSshTunnel(
    panel: vscode.WebviewPanel,
    config: ConnectionConfig,
    sshPassword?: string,
    sshPassphrase?: string,
  ): Promise<void> {
    try {
      const effectiveSshPassword = sshPassword ?? await this.connectionManager.getSshPassword(config.id);
      const effectiveSshPassphrase = sshPassphrase ?? await this.connectionManager.getSshPassphrase(config.id);
      await testSshTunnel(config, effectiveSshPassword, effectiveSshPassphrase);
      const resultMsg: ExtensionMessage = {
        type: 'sshTunnelTestResult',
        success: true,
      };
      void panel.webview.postMessage(resultMsg);
    } catch (err) {
      const resultMsg: ExtensionMessage = {
        type: 'sshTunnelTestResult',
        success: false,
        error: formatError(err),
      };
      void panel.webview.postMessage(resultMsg);
    }
  }

  private async handleSaveConnection(
    panel: vscode.WebviewPanel,
    config: ConnectionConfig,
    password?: string,
    sshPassword?: string,
    sshPassphrase?: string,
  ): Promise<void> {
    try {
      // 기존 커넥션 편집 시 비밀번호 미입력이면 저장된 비밀번호로 폴백
      const effectivePassword = password ?? await this.connectionManager.getPassword(config.id);
      const effectiveSshPassword = sshPassword ?? await this.connectionManager.getSshPassword(config.id);
      const effectiveSshPassphrase = sshPassphrase ?? await this.connectionManager.getSshPassphrase(config.id);
      await this.connectionManager.saveConnection(config, effectivePassword, effectiveSshPassword, effectiveSshPassphrase);
      const connections = this.connectionManager.getConnectionInfos();
      const syncMsg: ExtensionMessage = {
        type: 'stateSync',
        connections,
      };
      void panel.webview.postMessage(syncMsg);
    } catch (err) {
      const errMsg: ExtensionMessage = {
        type: 'error',
        message: String(err),
      };
      void panel.webview.postMessage(errMsg);
    }
  }

  private async handleBrowseFile(
    panel: vscode.WebviewPanel,
    target: 'sqlite' | 'sshKey',
  ): Promise<void> {
    const options: vscode.OpenDialogOptions =
      target === 'sqlite'
        ? {
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            title: vscode.l10n.t('Select SQLite Database File'),
            filters: { [vscode.l10n.t('SQLite Database')]: ['db', 'sqlite', 'sqlite3', 'db3'], [vscode.l10n.t('All Files')]: ['*'] },
          }
        : {
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            title: vscode.l10n.t('Select SSH Private Key'),
            defaultUri: vscode.Uri.file(require('os').homedir() + '/.ssh'),
          };

    const uris = await vscode.window.showOpenDialog(options);
    const picked = uris?.[0];
    if (picked) {
      const pickedMsg: ExtensionMessage = {
        type: 'filePicked',
        target,
        path: picked.fsPath,
      };
      void panel.webview.postMessage(pickedMsg);
    }
  }

  getWebviewContent(webview: vscode.Webview, nonce: string, meta: PanelMeta): string {
    const webviewDistUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDistUri, 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDistUri, 'webview.css'));

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `font-src ${webview.cspSource} data:`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ') + '; clipboard-read; clipboard-write';

    const initialState = JSON.stringify({
      meta: {
        kind: meta.kind,
        connectionId: meta.connectionId,
        tableName: meta.tableName,
        schema: meta.schema,
        database: meta.database,
        editId: meta.editId,
        redisDb: meta.redisDb,
        initialSql: meta.initialSql,
      },
      l10nContents: this.getWebviewL10nContents(),
    });

    const lang = vscode.env.language || 'en';

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>DB Manager</title>
  <style>
    html, body, #root {
      height: 100%;
      margin: 0;
      padding: 0;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.__INITIAL_STATE__ = ${initialState};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getWebviewL10nContents(): Record<string, string> | undefined {
    const locale = vscode.env.language;
    if (!locale || locale === 'en') return undefined;
    const bundlePath = path.join(
      this.context.extensionPath,
      'dist',
      'webview',
      'l10n',
      `bundle.l10n.${locale}.json`,
    );
    try {
      return JSON.parse(readFileSync(bundlePath, 'utf-8')) as Record<string, string>;
    } catch {
      return undefined;
    }
  }

  getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}

// ---------------------------------------------------------------------------
// CSV / SQL helpers (module-level, not exported)
// ---------------------------------------------------------------------------

function csvEscape(value: string, delimiter: string): string {
  const needsQuote = value.includes('"') || value.includes(delimiter) || value.includes('\n');
  if (needsQuote) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlTagName(name: string): string {
  let tag = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (/^[0-9.-]/.test(tag)) tag = '_' + tag;
  return tag || '_field';
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  // Escape single quotes for SQL string literals
  return "'" + String(value).replace(/'/g, "''") + "'";
}
