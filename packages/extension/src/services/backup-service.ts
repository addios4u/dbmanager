import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import type { ConnectionConfig, DatabaseType } from '@dbmanager/shared';
import { DEFAULT_PORTS, PAGE_SIZE } from '@dbmanager/shared';
import type { ConnectionManager } from './connection-manager.js';
import type { DatabaseAdapter } from '../adapters/base.js';

export class BackupService {
  private readonly cliCache = new Map<string, string | false>();

  constructor(private readonly connectionManager: ConnectionManager) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async backupDatabase(connectionId: string, database: string): Promise<void> {
    const config = this.connectionManager.getConnection(connectionId);
    if (!config) {
      vscode.window.showErrorMessage('Connection not found.');
      return;
    }
    if (!this.connectionManager.isConnected(connectionId)) {
      vscode.window.showErrorMessage('Database is not connected.');
      return;
    }

    const isSqlite = config.type === 'sqlite';
    const filters: Record<string, string[]> = isSqlite
      ? { 'Database Files': ['db', 'sqlite', 'sqlite3', 'bak'], 'All Files': ['*'] }
      : { 'SQL Files': ['sql'], 'All Files': ['*'] };

    const defaultName = isSqlite
      ? `${database}-backup-${timestamp()}.db`
      : `${database}-backup-${timestamp()}.sql`;

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultName),
      filters,
      title: `Backup Database: ${database}`,
    });
    if (!saveUri) return;

    const filePath = saveUri.fsPath;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Backing up "${database}"`, cancellable: true },
      async (progress, token) => {
        try {
          await this.dispatchBackup(config, connectionId, database, filePath, progress, token);
          const action = await vscode.window.showInformationMessage(
            `Backup complete: ${filePath}`,
            'Open File',
          );
          if (action === 'Open File') {
            void vscode.env.openExternal(vscode.Uri.file(filePath));
          }
        } catch (err) {
          // Clean up partial file on failure
          try { await fsp.unlink(filePath); } catch { /* ignore */ }
          vscode.window.showErrorMessage(`Backup failed: ${errMsg(err)}`);
        }
      },
    );
  }

  async restoreDatabase(
    connectionId: string,
    database: string,
    refreshCallback?: () => void,
  ): Promise<void> {
    const config = this.connectionManager.getConnection(connectionId);
    if (!config) {
      vscode.window.showErrorMessage('Connection not found.');
      return;
    }
    if (!this.connectionManager.isConnected(connectionId)) {
      vscode.window.showErrorMessage('Database is not connected.');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Restoring will overwrite data in database "${database}". This action cannot be undone. Continue?`,
      { modal: true },
      'Restore',
    );
    if (confirm !== 'Restore') return;

    const isSqlite = config.type === 'sqlite';
    const filters: Record<string, string[]> = isSqlite
      ? { 'Database Files': ['db', 'sqlite', 'sqlite3', 'bak'], 'All Files': ['*'] }
      : { 'SQL Files': ['sql'], 'All Files': ['*'] };

    const openUri = await vscode.window.showOpenDialog({
      filters,
      canSelectMany: false,
      title: `Restore Database: ${database}`,
    });
    const selectedUri = openUri?.[0];
    if (!selectedUri) return;

    const filePath = selectedUri.fsPath;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Restoring "${database}"`, cancellable: false },
      async (progress) => {
        try {
          await this.dispatchRestore(config, connectionId, database, filePath, progress);
          refreshCallback?.();
          vscode.window.showInformationMessage(`Restore complete: ${database}`);
        } catch (err) {
          vscode.window.showErrorMessage(`Restore failed: ${errMsg(err)}`);
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Dispatcher
  // ---------------------------------------------------------------------------

  private async dispatchBackup(
    config: ConnectionConfig,
    connectionId: string,
    database: string,
    filePath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const password = await this.connectionManager.getPassword(connectionId);

    switch (config.type) {
      case 'mysql':
      case 'mariadb':
        await this.backupMysql(config, connectionId, database, filePath, password, progress, token);
        break;
      case 'postgresql':
        await this.backupPostgresql(config, connectionId, database, filePath, password, progress, token);
        break;
      case 'sqlite':
        await this.backupSqlite(config, filePath, progress);
        break;
      default:
        throw new Error(`Backup not supported for ${config.type}`);
    }
  }

  private async dispatchRestore(
    config: ConnectionConfig,
    connectionId: string,
    database: string,
    filePath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    const password = await this.connectionManager.getPassword(connectionId);

    switch (config.type) {
      case 'mysql':
      case 'mariadb':
        await this.restoreMysql(config, connectionId, database, filePath, password, progress);
        break;
      case 'postgresql':
        await this.restorePostgresql(config, connectionId, database, filePath, password, progress);
        break;
      case 'sqlite':
        await this.restoreSqlite(config, connectionId, filePath, progress);
        break;
      default:
        throw new Error(`Restore not supported for ${config.type}`);
    }
  }

  // ---------------------------------------------------------------------------
  // MySQL / MariaDB Backup
  // ---------------------------------------------------------------------------

  private async backupMysql(
    config: ConnectionConfig,
    connectionId: string,
    database: string,
    filePath: string,
    password: string | undefined,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const toolPath = await this.promptCliPath('mysqldump');
    if (toolPath) {
      try {
        await this.backupMysqlCli(config, connectionId, database, filePath, password, toolPath, progress, token);
        return;
      } catch {
        progress.report({ message: 'CLI failed, falling back to SQL...' });
      }
    }
    await this.backupMysqlSql(connectionId, database, filePath, config.type, progress, token);
  }

  private async backupMysqlCli(
    config: ConnectionConfig,
    connectionId: string,
    database: string,
    filePath: string,
    password: string | undefined,
    toolPath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const { host, port } = this.getConnectionParams(config, connectionId);
    const args = [
      '--host', host,
      '--port', String(port),
      '--single-transaction',
      '--routines',
      '--triggers',
      '--set-gtid-purged=OFF',
      '--result-file', filePath,
    ];
    if (config.username) args.push('--user', config.username);
    args.push(database);

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (password) env['MYSQL_PWD'] = password;

    progress.report({ message: 'Running mysqldump...' });
    await this.spawnCliTool(toolPath, args, env, token);
  }

  private async backupMysqlSql(
    connectionId: string,
    database: string,
    filePath: string,
    dbType: DatabaseType,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId) as DatabaseAdapter;

    // Switch to the target database
    await adapter.execute(`USE ${quoteId(database, dbType)}`);

    const fh = await fsp.open(filePath, 'w');
    try {
      await fh.write(`-- DBManager Backup: ${database}\n`);
      await fh.write(`-- Date: ${new Date().toISOString()}\n`);
      await fh.write(`-- Method: Pure SQL\n\n`);
      await fh.write(`SET FOREIGN_KEY_CHECKS=0;\n\n`);

      const allTables = await adapter.getTables();
      const tables = allTables.filter((t) => t.type === 'table');
      const views = allTables.filter((t) => t.type === 'view');
      const total = tables.length + views.length;
      let done = 0;

      for (const table of tables) {
        throwIfCancelled(token);
        progress.report({ message: `${table.name} (${++done}/${total})` });

        const ddl = await adapter.getTableDDL(table.name);
        await fh.write(`DROP TABLE IF EXISTS ${quoteId(table.name, dbType)};\n`);
        await fh.write(`${ddl.replace(/;+\s*$/, '')};\n\n`);

        await this.dumpTableData(adapter, table.name, dbType, fh, token);
      }

      for (const view of views) {
        throwIfCancelled(token);
        progress.report({ message: `view ${view.name} (${++done}/${total})` });

        const ddl = await adapter.getTableDDL(view.name);
        await fh.write(`DROP VIEW IF EXISTS ${quoteId(view.name, dbType)};\n`);
        await fh.write(`${ddl.replace(/;+\s*$/, '')};\n\n`);
      }

      await fh.write(`SET FOREIGN_KEY_CHECKS=1;\n`);
    } finally {
      await fh.close();
    }
  }

  // ---------------------------------------------------------------------------
  // PostgreSQL Backup
  // ---------------------------------------------------------------------------

  private async backupPostgresql(
    config: ConnectionConfig,
    connectionId: string,
    database: string,
    filePath: string,
    password: string | undefined,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const toolPath = await this.promptCliPath('pg_dump');
    if (toolPath) {
      try {
        await this.backupPgCli(config, connectionId, database, filePath, password, toolPath, progress, token);
        return;
      } catch {
        progress.report({ message: 'CLI failed, falling back to SQL...' });
      }
    }
    await this.backupPgSql(connectionId, database, filePath, progress, token);
  }

  private async backupPgCli(
    config: ConnectionConfig,
    connectionId: string,
    database: string,
    filePath: string,
    password: string | undefined,
    toolPath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const { host, port } = this.getConnectionParams(config, connectionId);
    const args = [
      '--host', host,
      '--port', String(port),
      '--format', 'plain',
      '--clean',
      '--if-exists',
      '--file', filePath,
      '--no-password',
    ];
    if (config.username) args.push('--username', config.username);
    args.push(database);

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (password) env['PGPASSWORD'] = password;

    progress.report({ message: 'Running pg_dump...' });
    await this.spawnCliTool(toolPath, args, env, token);
  }

  private async backupPgSql(
    connectionId: string,
    database: string,
    filePath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId) as DatabaseAdapter;
    const dbType: DatabaseType = 'postgresql';

    // Switch to the target database
    const pgAdapter = adapter as DatabaseAdapter & { switchDatabase?(db: string): Promise<void> };
    if (pgAdapter.switchDatabase) {
      await pgAdapter.switchDatabase(database);
    }

    const fh = await fsp.open(filePath, 'w');
    try {
      await fh.write(`-- DBManager Backup: ${database}\n`);
      await fh.write(`-- Date: ${new Date().toISOString()}\n`);
      await fh.write(`-- Method: Pure SQL\n\n`);

      const schemas = await adapter.getSchemas();
      // Filter out system schemas
      const userSchemas = schemas.filter(
        (s) => !s.startsWith('pg_') && s !== 'information_schema',
      );

      // Collect sequence setval statements to execute after all data is inserted
      const sequenceSetvals: string[] = [];

      for (const schema of userSchemas) {
        throwIfCancelled(token);
        progress.report({ message: `Schema: ${schema}` });

        await fh.write(`-- Schema: ${schema}\n`);
        if (schema !== 'public') {
          await fh.write(`CREATE SCHEMA IF NOT EXISTS ${quoteId(schema, dbType)};\n`);
        }
        await fh.write(`SET search_path TO ${quoteId(schema, dbType)};\n\n`);

        // Set search_path for subsequent queries
        await adapter.execute(`SET search_path TO ${quoteId(schema, dbType)}`);

        // Dump sequences before tables (tables may reference them via nextval)
        await this.dumpPgSequences(adapter, schema, dbType, fh, sequenceSetvals);

        const allTables = await adapter.getTables(schema);
        const tables = allTables.filter((t) => t.type === 'table');
        const views = allTables.filter((t) => t.type === 'view');

        for (const table of tables) {
          throwIfCancelled(token);
          progress.report({ message: `${schema}.${table.name}` });

          const ddl = await adapter.getTableDDL(table.name, schema);
          await fh.write(`DROP TABLE IF EXISTS ${quoteId(schema, dbType)}.${quoteId(table.name, dbType)} CASCADE;\n`);
          await fh.write(`${ddl.replace(/;+\s*$/, '')};\n\n`);

          await this.dumpTableData(
            adapter,
            `${quoteId(schema, dbType)}.${quoteId(table.name, dbType)}`,
            dbType,
            fh,
            token,
            table.name,
            schema,
          );
        }

        for (const view of views) {
          throwIfCancelled(token);
          progress.report({ message: `view ${schema}.${view.name}` });

          const ddl = await adapter.getTableDDL(view.name, schema);
          await fh.write(`DROP VIEW IF EXISTS ${quoteId(schema, dbType)}.${quoteId(view.name, dbType)} CASCADE;\n`);
          await fh.write(`${ddl.replace(/;+\s*$/, '')};\n\n`);
        }
      }

      // Set sequence values after all data is inserted
      if (sequenceSetvals.length > 0) {
        await fh.write(`-- Restore sequence values\n`);
        for (const setval of sequenceSetvals) {
          await fh.write(`${setval}\n`);
        }
        await fh.write('\n');
      }
    } finally {
      await fh.close();
    }
  }

  // ---------------------------------------------------------------------------
  // SQLite Backup / Restore
  // ---------------------------------------------------------------------------

  private async backupSqlite(
    config: ConnectionConfig,
    filePath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    const sourcePath = resolvePath(config.filepath ?? '');
    if (!sourcePath) throw new Error('SQLite file path is required');

    progress.report({ message: 'Copying database file...' });
    await fsp.copyFile(sourcePath, filePath);

    // Copy WAL and SHM files if they exist
    for (const suffix of ['-wal', '-shm']) {
      const src = sourcePath + suffix;
      try {
        await fsp.access(src);
        await fsp.copyFile(src, filePath + suffix);
      } catch { /* file doesn't exist, skip */ }
    }
  }

  private async restoreSqlite(
    config: ConnectionConfig,
    connectionId: string,
    filePath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    const targetPath = resolvePath(config.filepath ?? '');
    if (!targetPath) throw new Error('SQLite file path is required');

    // Disconnect to release file handle (better-sqlite3 holds a lock)
    await this.connectionManager.disconnect(connectionId);

    try {
      progress.report({ message: 'Restoring database file...' });
      await fsp.copyFile(filePath, targetPath);

      // Remove stale WAL/SHM from target
      for (const suffix of ['-wal', '-shm']) {
        try { await fsp.unlink(targetPath + suffix); } catch { /* ignore */ }
      }

      // Copy WAL/SHM from backup if they exist
      for (const suffix of ['-wal', '-shm']) {
        const src = filePath + suffix;
        try {
          await fsp.access(src);
          await fsp.copyFile(src, targetPath + suffix);
        } catch { /* ignore */ }
      }
    } finally {
      // Reconnect regardless of outcome
      await this.connectionManager.connect(connectionId);
    }
  }

  // ---------------------------------------------------------------------------
  // MySQL / MariaDB Restore
  // ---------------------------------------------------------------------------

  private async restoreMysql(
    config: ConnectionConfig,
    connectionId: string,
    database: string,
    filePath: string,
    password: string | undefined,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    const toolPath = await this.promptCliPath('mysql');
    if (toolPath) {
      try {
        await this.restoreMysqlCli(config, connectionId, database, filePath, password, toolPath, progress);
        return;
      } catch {
        progress.report({ message: 'CLI failed, falling back to SQL...' });
      }
    }
    await this.restoreMysqlSql(connectionId, database, filePath, config.type, progress);
  }

  private async restoreMysqlCli(
    config: ConnectionConfig,
    connectionId: string,
    database: string,
    filePath: string,
    password: string | undefined,
    toolPath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    const { host, port } = this.getConnectionParams(config, connectionId);
    const args = [
      '--host', host,
      '--port', String(port),
      '--database', database,
    ];
    if (config.username) args.push('--user', config.username);

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (password) env['MYSQL_PWD'] = password;

    progress.report({ message: 'Restoring from SQL file...' });
    await this.spawnCliToolWithFileInput(toolPath, args, filePath, env);
  }

  private async restoreMysqlSql(
    connectionId: string,
    database: string,
    filePath: string,
    dbType: DatabaseType,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId) as DatabaseAdapter;
    await adapter.execute(`USE ${quoteId(database, dbType)}`);
    await this.executeSqlFile(adapter, filePath, progress);
  }

  // ---------------------------------------------------------------------------
  // PostgreSQL Restore
  // ---------------------------------------------------------------------------

  private async restorePostgresql(
    config: ConnectionConfig,
    connectionId: string,
    database: string,
    filePath: string,
    password: string | undefined,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    const toolPath = await this.promptCliPath('psql');
    if (toolPath) {
      try {
        await this.restorePgCli(config, connectionId, database, filePath, password, toolPath, progress);
        return;
      } catch {
        progress.report({ message: 'CLI failed, falling back to SQL...' });
      }
    }
    await this.restorePgSql(connectionId, database, filePath, progress);
  }

  private async restorePgCli(
    config: ConnectionConfig,
    connectionId: string,
    database: string,
    filePath: string,
    password: string | undefined,
    toolPath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    const { host, port } = this.getConnectionParams(config, connectionId);
    const args = [
      '--host', host,
      '--port', String(port),
      '--dbname', database,
      '--file', filePath,
      '--no-password',
    ];
    if (config.username) args.push('--username', config.username);

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (password) env['PGPASSWORD'] = password;

    progress.report({ message: 'Restoring from SQL file...' });
    try {
      await this.spawnCliTool(toolPath, args, env);
    } catch (err) {
      // psql returns non-zero if any statement fails, but tables without errors are restored.
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(
        `psql completed with errors. Some statements may have failed:\n${msg.slice(0, 300)}`,
      );
    }
  }

  private async restorePgSql(
    connectionId: string,
    database: string,
    filePath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    const adapter = this.connectionManager.getAdapter(connectionId) as DatabaseAdapter;
    const pgAdapter = adapter as DatabaseAdapter & { switchDatabase?(db: string): Promise<void> };
    if (pgAdapter.switchDatabase) {
      await pgAdapter.switchDatabase(database);
    }
    await this.executePgSqlFile(adapter, filePath, progress);
  }

  /**
   * PostgreSQL-specific SQL file executor.
   * Pre-processes INSERT statements to fix integer values in boolean columns
   * (backwards compatibility with older backup files).
   */
  private async executePgSqlFile(
    adapter: DatabaseAdapter,
    filePath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    const content = await fsp.readFile(filePath, 'utf-8');
    const statements = splitSqlStatements(content);
    const total = statements.length;
    const errors: string[] = [];

    // Phase 1: Pre-scan statements for boolean/JSON columns and missing sequences
    const boolColumnsByTable = new Map<string, Set<string>>();
    const jsonColumnsByTable = new Map<string, Set<string>>();
    const referencedSequences = new Set<string>();
    const definedSequences = new Set<string>();

    for (const stmt of statements) {
      // Identify boolean and JSON/JSONB columns from CREATE TABLE
      const createMatch = stmt.match(/CREATE\s+TABLE\s+(?:"[^"]*"\.)?"([^"]+)"/i);
      if (createMatch) {
        const tableName = createMatch[1]!;
        const boolCols = new Set<string>();
        const colRegex = /"([^"]+)"\s+boolean/gi;
        let m;
        while ((m = colRegex.exec(stmt)) !== null) {
          boolCols.add(m[1]!);
        }
        if (boolCols.size > 0) {
          boolColumnsByTable.set(tableName, boolCols);
        }

        // Detect JSON/JSONB columns
        const jsonCols = new Set<string>();
        const jsonColRegex = /"([^"]+)"\s+jsonb?\b/gi;
        let jm;
        while ((jm = jsonColRegex.exec(stmt)) !== null) {
          jsonCols.add(jm[1]!);
        }
        if (jsonCols.size > 0) {
          jsonColumnsByTable.set(tableName, jsonCols);
        }

        // Collect sequence references from nextval('seq_name'::regclass)
        const seqRefRegex = /nextval\('([^']+)'::regclass\)/gi;
        let sm;
        while ((sm = seqRefRegex.exec(stmt)) !== null) {
          referencedSequences.add(sm[1]!);
        }
      }

      // Track explicitly defined sequences
      const seqMatch = stmt.match(/CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]*"\.)?"([^"]+)"/i);
      if (seqMatch) {
        definedSequences.add(seqMatch[1]!);
      }
    }

    // Phase 2: Auto-create missing sequences (backwards compat with old backups)
    for (const seqName of referencedSequences) {
      // Strip schema prefix if present (e.g. "public.seq_name" → "seq_name")
      const bare = seqName.includes('.') ? seqName.split('.').pop()! : seqName;
      if (!definedSequences.has(bare) && !definedSequences.has(seqName)) {
        progress.report({ message: `Creating missing sequence: ${seqName}` });
        try {
          await adapter.execute(`CREATE SEQUENCE IF NOT EXISTS "${bare}"`);
        } catch {
          // Sequence might already exist in the database — ignore
        }
      }
    }

    // Phase 3: Execute statements, fixing boolean values in INSERTs
    for (let i = 0; i < total; i++) {
      let stmt = statements[i]!;
      if (!stmt) continue;

      progress.report({ message: `Statement ${i + 1}/${total}` });

      // Fix boolean values in INSERT statements
      if (boolColumnsByTable.size > 0) {
        stmt = fixPgBooleanInsert(stmt, boolColumnsByTable);
      }

      // Use parameterized queries for INSERT into tables with JSON/JSONB columns
      if (jsonColumnsByTable.size > 0) {
        const insertMatch = stmt.match(/^INSERT\s+INTO\s+"([^"]+)"\s+\(([^)]+)\)\s+VALUES\s+\(/i);
        if (insertMatch && jsonColumnsByTable.has(insertMatch[1]!)) {
          try {
            const tableName = insertMatch[1]!;
            const columnsStr = insertMatch[2]!;
            const valuesStart = insertMatch[0]!.length;
            const valuesSection = stmt.slice(valuesStart, -1); // remove trailing ")"
            const values = splitSqlValues(valuesSection);
            const params = values.map((v) => parseSqlLiteral(v.trim()));
            const placeholders = values.map((_, idx) => `$${idx + 1}`).join(', ');
            await adapter.execute(
              `INSERT INTO "${tableName}" (${columnsStr}) VALUES (${placeholders})`,
              params,
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const preview = stmt.length > 80 ? stmt.slice(0, 80) + '...' : stmt;
            errors.push(`[${i + 1}] ${msg}\n    ${preview}`);
          }
          continue;
        }
      }

      try {
        await adapter.execute(stmt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const preview = stmt.length > 80 ? stmt.slice(0, 80) + '...' : stmt;
        errors.push(`[${i + 1}] ${msg}\n    ${preview}`);
      }
    }

    if (errors.length > 0) {
      const succeeded = total - errors.length;
      vscode.window.showWarningMessage(
        `Restore completed with ${errors.length} error(s) out of ${total} statements (${succeeded} succeeded).`,
        'Show Details',
      ).then((action) => {
        if (action === 'Show Details') {
          const doc = errors.join('\n\n');
          void vscode.workspace.openTextDocument({ content: doc, language: 'text' })
            .then((d) => vscode.window.showTextDocument(d));
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Shared helpers: data dump & SQL file execution
  // ---------------------------------------------------------------------------

  /**
   * Dump PostgreSQL sequences for a schema.
   * CREATE SEQUENCE statements are written immediately;
   * setval() calls are collected and written after all data is inserted.
   */
  private async dumpPgSequences(
    adapter: DatabaseAdapter,
    schema: string,
    dbType: DatabaseType,
    fh: fsp.FileHandle,
    sequenceSetvals: string[],
  ): Promise<void> {
    const seqResult = await adapter.execute(
      `SELECT sequencename, start_value, min_value, max_value,
              increment_by, cycle, cache_size, last_value
       FROM pg_sequences
       WHERE schemaname = $1
       ORDER BY sequencename`,
      [schema],
    );

    if (seqResult.rows.length === 0) return;

    await fh.write(`-- Sequences\n`);
    for (const seq of seqResult.rows) {
      const seqName = String(seq['sequencename']);
      const qualifiedSeq = `${quoteId(schema, dbType)}.${quoteId(seqName, dbType)}`;

      await fh.write(`DROP SEQUENCE IF EXISTS ${qualifiedSeq} CASCADE;\n`);
      await fh.write(
        `CREATE SEQUENCE ${qualifiedSeq}\n` +
        `  INCREMENT BY ${seq['increment_by']}\n` +
        `  MINVALUE ${seq['min_value']}\n` +
        `  MAXVALUE ${seq['max_value']}\n` +
        `  START WITH ${seq['start_value']}\n` +
        `  CACHE ${seq['cache_size']}\n` +
        `  ${seq['cycle'] ? 'CYCLE' : 'NO CYCLE'};\n\n`,
      );

      if (seq['last_value'] != null) {
        sequenceSetvals.push(
          `SELECT setval('${schema}.${seqName}', ${seq['last_value']}, true);`,
        );
      }
    }
  }

  private async dumpTableData(
    adapter: DatabaseAdapter,
    qualifiedTable: string,
    dbType: DatabaseType,
    fh: fsp.FileHandle,
    token: vscode.CancellationToken,
    rawTableName?: string,
    schema?: string,
  ): Promise<void> {
    const isPostgres = dbType === 'postgresql';
    let offset = 0;

    // For PG, query information_schema for boolean & JSON/JSONB columns
    let boolCols: Set<string> | undefined;
    let jsonCols: Set<string> | undefined;
    if (isPostgres && rawTableName && schema) {
      const typeResult = await adapter.execute(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
           AND data_type IN ('boolean', 'json', 'jsonb')`,
        [schema, rawTableName],
      );
      for (const r of typeResult.rows) {
        const colName = String(r['column_name']);
        const dataType = String(r['data_type']);
        if (dataType === 'boolean') {
          if (!boolCols) boolCols = new Set();
          boolCols.add(colName);
        } else {
          if (!jsonCols) jsonCols = new Set();
          jsonCols.add(colName);
        }
      }
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      throwIfCancelled(token);

      const limitClause = isPostgres
        ? `LIMIT $1 OFFSET $2`
        : `LIMIT ? OFFSET ?`;
      const result = await adapter.execute(
        `SELECT * FROM ${qualifiedTable} ${limitClause}`,
        [PAGE_SIZE, offset],
      );
      if (result.rows.length === 0) break;

      const insertTable = rawTableName
        ? quoteId(rawTableName, dbType)
        : qualifiedTable;

      // Fallback: detect boolean columns from OID if information_schema was not used
      if (isPostgres && !boolCols) {
        const oidBools = result.columns.filter((c) => c.type === '16').map((c) => c.name);
        if (oidBools.length > 0) boolCols = new Set(oidBools);
      }

      for (const row of result.rows) {
        const keys = Object.keys(row);
        const cols = keys.map((c) => quoteId(c, dbType)).join(', ');
        const vals = keys.map((k) => {
          const v = row[k];
          if (boolCols?.has(k)) {
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
            if (typeof v === 'number') return v !== 0 ? 'TRUE' : 'FALSE';
            if (typeof v === 'string') return v === 't' || v === 'true' || v === '1' ? 'TRUE' : 'FALSE';
          }
          if (jsonCols?.has(k)) {
            if (v === null || v === undefined) return 'NULL';
            // Always use JSON.stringify — handles arrays, objects, and primitives correctly
            return "'" + JSON.stringify(v).replace(/'/g, "''") + "'";
          }
          return sqlValue(v);
        }).join(', ');
        await fh.write(`INSERT INTO ${insertTable} (${cols}) VALUES (${vals});\n`);
      }

      offset += PAGE_SIZE;
      if (result.rows.length < PAGE_SIZE) break;
    }

    if (offset > 0) {
      await fh.write('\n');
    }
  }

  private async executeSqlFile(
    adapter: DatabaseAdapter,
    filePath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<void> {
    const content = await fsp.readFile(filePath, 'utf-8');
    const statements = splitSqlStatements(content);
    const total = statements.length;
    const errors: string[] = [];

    for (let i = 0; i < total; i++) {
      const stmt = statements[i];
      if (!stmt) continue;

      progress.report({ message: `Statement ${i + 1}/${total}` });
      try {
        await adapter.execute(stmt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const preview = stmt.length > 80 ? stmt.slice(0, 80) + '...' : stmt;
        errors.push(`[${i + 1}] ${msg}\n    ${preview}`);
      }
    }

    if (errors.length > 0) {
      const succeeded = total - errors.length;
      vscode.window.showWarningMessage(
        `Restore completed with ${errors.length} error(s) out of ${total} statements (${succeeded} succeeded).`,
        'Show Details',
      ).then((action) => {
        if (action === 'Show Details') {
          const doc = errors.join('\n\n');
          void vscode.workspace.openTextDocument({ content: doc, language: 'text' })
            .then((d) => vscode.window.showTextDocument(d));
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // CLI tool detection & execution
  // ---------------------------------------------------------------------------

  private async findCliTool(name: string): Promise<string | undefined> {
    const cached = this.cliCache.get(name);
    if (cached !== undefined) return cached || undefined;

    const cmd = process.platform === 'win32' ? 'where' : 'which';
    try {
      const stdout = await execPromise(cmd, [name]);
      const toolPath = stdout.trim().split('\n')[0];
      if (toolPath) {
        this.cliCache.set(name, toolPath);
        return toolPath;
      }
      this.cliCache.set(name, false);
      return undefined;
    } catch {
      this.cliCache.set(name, false);
      return undefined;
    }
  }

  /**
   * CLI 경로를 자동 감지한 뒤 InputBox로 사용자에게 확인/수정 기회를 준다.
   * - 값을 비우고 확인하면 CLI를 건너뛰고 SQL 폴백 사용.
   * - ESC로 취소하면 undefined 반환 (SQL 폴백).
   */
  private async promptCliPath(toolName: string): Promise<string | undefined> {
    const detected = await this.findCliTool(toolName);
    const userInput = await vscode.window.showInputBox({
      title: `${toolName} CLI Path`,
      prompt: `${toolName} 경로를 확인하세요. 비워두면 SQL 방식으로 실행합니다.`,
      value: detected ?? '',
      placeHolder: `/usr/local/bin/${toolName}`,
      ignoreFocusOut: true,
    });

    // ESC 취소 또는 빈 문자열 → CLI 건너뜀
    if (userInput === undefined || userInput.trim() === '') {
      return undefined;
    }
    return userInput.trim();
  }

  private spawnCliTool(
    cmd: string,
    args: string[],
    env?: Record<string, string>,
    token?: vscode.CancellationToken,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = cp.spawn(cmd, args, {
        env: env ?? (process.env as Record<string, string>),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const disposable = token?.onCancellationRequested(() => {
        proc.kill('SIGTERM');
      });

      proc.on('close', (code) => {
        disposable?.dispose();
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `${cmd} exited with code ${code}`));
        }
      });
      proc.on('error', (err) => {
        disposable?.dispose();
        reject(err);
      });
    });
  }

  private spawnCliToolWithFileInput(
    cmd: string,
    args: string[],
    inputFilePath: string,
    env?: Record<string, string>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = cp.spawn(cmd, args, {
        env: env ?? (process.env as Record<string, string>),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const inputStream = fs.createReadStream(inputFilePath);
      inputStream.pipe(proc.stdin);

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `${cmd} exited with code ${code}`));
        }
      });
      proc.on('error', reject);
    });
  }

  // ---------------------------------------------------------------------------
  // Connection params (SSH tunnel aware)
  // ---------------------------------------------------------------------------

  private getConnectionParams(
    config: ConnectionConfig,
    connectionId: string,
  ): { host: string; port: number } {
    if (config.ssh?.enabled) {
      const tunnelPort = this.connectionManager.sshTunnels.getTunnelPort(connectionId);
      if (tunnelPort) {
        return { host: '127.0.0.1', port: tunnelPort };
      }
    }
    return {
      host: config.host ?? 'localhost',
      port: config.port ?? DEFAULT_PORTS[config.type] ?? 3306,
    };
  }
}

// =============================================================================
// Standalone utility functions
// =============================================================================

function quoteId(name: string, dbType: DatabaseType): string {
  if (dbType === 'mysql' || dbType === 'mariadb') {
    return '`' + name.replace(/`/g, '``') + '`';
  }
  return '"' + name.replace(/"/g, '""') + '"';
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  if (Array.isArray(value)) {
    // PostgreSQL array literal: '{val1,val2,...}'
    const elements = value.map((v) => {
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number' || typeof v === 'bigint') return String(v);
      if (typeof v === 'boolean') return v ? 't' : 'f';
      // Escape double-quotes and backslashes inside array elements
      const s = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${s}"`;
    });
    return `'${`{${elements.join(',')}}`}'`;
  }
  // Plain objects (JSON/JSONB columns) — serialize with JSON.stringify
  if (typeof value === 'object') {
    return "'" + JSON.stringify(value).replace(/'/g, "''") + "'";
  }
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;

    if (inString) {
      current += ch;
      if (ch === stringChar) {
        if (sql[i + 1] === stringChar) {
          current += sql[++i]; // escaped quote
        } else {
          inString = false;
        }
      }
    } else if (ch === '-' && sql[i + 1] === '-') {
      // Single-line comment: skip to end of line
      while (i < sql.length && sql[i] !== '\n') {
        i++;
      }
    } else if (ch === '/' && sql[i + 1] === '*') {
      // Block comment: skip to */
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        i++;
      }
      i++; // skip past '/'
    } else if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
      current += ch;
    } else if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
    } else {
      current += ch;
    }
  }

  const trimmed = current.trim();
  if (trimmed) {
    statements.push(trimmed);
  }

  return statements;
}

function resolvePath(filepath: string): string {
  if (filepath.startsWith('~')) {
    return filepath.replace(/^~/, os.homedir());
  }
  return filepath;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new Error('Backup cancelled');
  }
}

function execPromise(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile(cmd, args, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * Fix integer boolean values (0/1) in a PostgreSQL INSERT statement.
 * Converts 0→FALSE, 1→TRUE for columns known to be boolean.
 */
function fixPgBooleanInsert(
  stmt: string,
  boolColumnsByTable: Map<string, Set<string>>,
): string {
  // Match: INSERT INTO "tablename" (columns) VALUES (
  const headerMatch = stmt.match(
    /^INSERT\s+INTO\s+"([^"]+)"\s+\(([^)]+)\)\s+VALUES\s+\(/i,
  );
  if (!headerMatch) return stmt;

  const tableName = headerMatch[1]!;
  const boolCols = boolColumnsByTable.get(tableName);
  if (!boolCols || boolCols.size === 0) return stmt;

  const columns = headerMatch[2]!.split(',').map((c) => c.trim().replace(/"/g, ''));
  const boolIndices = new Set<number>();
  columns.forEach((col, i) => {
    if (boolCols.has(col)) boolIndices.add(i);
  });
  if (boolIndices.size === 0) return stmt;

  // Extract the VALUES part (everything after "VALUES (", removing trailing ")")
  const valuesStart = headerMatch[0]!.length;
  const valuesSection = stmt.slice(valuesStart, -1); // remove trailing ")"

  const values = splitSqlValues(valuesSection);
  let changed = false;

  for (const idx of boolIndices) {
    if (idx < values.length) {
      const v = values[idx]!.trim();
      if (v === '1') { values[idx] = 'TRUE'; changed = true; }
      else if (v === '0') { values[idx] = 'FALSE'; changed = true; }
    }
  }

  if (!changed) return stmt;
  return stmt.slice(0, valuesStart) + values.join(', ') + ')';
}

/**
 * Split a SQL VALUES content by commas, respecting single-quoted strings
 * and nested parentheses (e.g. array literals).
 */
function splitSqlValues(valuesStr: string): string[] {
  const values: string[] = [];
  let current = '';
  let inString = false;
  let depth = 0;

  for (let i = 0; i < valuesStr.length; i++) {
    const ch = valuesStr[i]!;

    if (inString) {
      current += ch;
      if (ch === "'" && valuesStr[i + 1] === "'") {
        current += valuesStr[++i]!; // escaped quote
      } else if (ch === "'") {
        inString = false;
      }
    } else if (ch === "'") {
      inString = true;
      current += ch;
    } else if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  const trimmed = current.trim();
  if (trimmed) values.push(trimmed);

  return values;
}

/**
 * Parse a SQL literal string back to a JavaScript value.
 * Used for parameterized query execution during restore.
 */
function parseSqlLiteral(literal: string): unknown {
  const upper = literal.toUpperCase();
  if (upper === 'NULL') return null;
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;

  // String literal: '...'
  if (literal.startsWith("'") && literal.endsWith("'") && literal.length >= 2) {
    return literal.slice(1, -1).replace(/''/g, "'");
  }

  // Hex literal: X'...'
  if (/^X'[0-9a-fA-F]*'$/i.test(literal)) {
    return Buffer.from(literal.slice(2, -1), 'hex');
  }

  // Number
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(literal)) {
    return Number(literal);
  }

  // Fallback: return as-is
  return literal;
}
