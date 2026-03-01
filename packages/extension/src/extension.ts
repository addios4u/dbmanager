import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ConnectionManager } from './services/connection-manager.js';
import { DatabaseTreeProvider } from './providers/database-tree.js';
import { WebviewPanelManager } from './webview/panel-manager.js';
import { SqlEditorProvider } from './webview/sql-editor-provider.js';
import { COMMAND_IDS, VIEW_IDS } from '@dbmanager/shared';
import { BackupService } from './services/backup-service.js';

let connectionManager: ConnectionManager;
let treeProvider: DatabaseTreeProvider;
let panelManager: WebviewPanelManager;

export function activate(context: vscode.ExtensionContext): void {
  // Initialize services
  connectionManager = new ConnectionManager(context);
  treeProvider = new DatabaseTreeProvider(connectionManager, context.extensionUri);
  panelManager = new WebviewPanelManager(context, connectionManager);

  // Register TreeView
  const treeView = vscode.window.createTreeView(VIEW_IDS.CONNECTIONS, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Register SQL CustomEditor
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      SqlEditorProvider.viewType,
      new SqlEditorProvider(panelManager),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // Auto-redirect .sql files opened in the default text editor to our custom editor
  let isRedirecting = false;
  const redirectSqlEditor = (editor: vscode.TextEditor | undefined) => {
    if (isRedirecting) return;
    if (!editor) return;
    if (editor.document.uri.scheme !== 'file') return;
    if (!editor.document.fileName.endsWith('.sql')) return;

    isRedirecting = true;
    const uri = editor.document.uri;
    void vscode.commands.executeCommand('workbench.action.closeActiveEditor').then(
      () => vscode.commands.executeCommand('vscode.openWith', uri, SqlEditorProvider.viewType),
    ).then(
      () => { isRedirecting = false; },
      () => { isRedirecting = false; },
    );
  };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(redirectSqlEditor),
  );
  // Also redirect if a .sql file is already active when the extension starts
  redirectSqlEditor(vscode.window.activeTextEditor);

  // Initialize backup service
  const backupService = new BackupService(connectionManager);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_IDS.ADD_CONNECTION, () => {
      panelManager.openConnectionDialog();
    }),
    vscode.commands.registerCommand(COMMAND_IDS.REFRESH, (node?: unknown) => {
      treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.CONNECT, (node) => {
      // node is the DbTreeNode passed from context menu
      void connectionManager.connect((node as { connectionId: string }).connectionId).then(() => {
        treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
      });
    }),
    vscode.commands.registerCommand(COMMAND_IDS.DISCONNECT, (node) => {
      void connectionManager.disconnect((node as { connectionId: string }).connectionId).then(() => {
        treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
      });
    }),
    vscode.commands.registerCommand(COMMAND_IDS.NEW_QUERY, async (node) => {
      const n = node as { connectionId: string; database?: string; schema?: string };
      // Remember last-used connection + context for SqlEditorProvider
      await context.globalState.update('dbmanager.lastQueryConnectionId', n.connectionId);
      await context.globalState.update('dbmanager.lastQueryDatabase', n.database);
      await context.globalState.update('dbmanager.lastQuerySchema', n.schema);
      // Build metadata header comment
      const conn = connectionManager.getConnection(n.connectionId);
      const connName = conn?.name ?? n.connectionId;
      const connType = conn?.type ?? 'unknown';
      let header = `-- DBManager: ${connName} (${connType})`;
      if (n.database) header += ` | Database: ${n.database}`;
      if (n.schema) header += ` | Schema: ${n.schema}`;
      header += '\n\n';
      // Create .sql file in workspace dbmanager folder
      const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
      const queryDir = path.join(wsFolder, 'dbmanager');
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(queryDir));
      const fileName = `untitled-${Date.now()}.sql`;
      const fileUri = vscode.Uri.file(path.join(queryDir, fileName));
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(header, 'utf-8'));
      await vscode.commands.executeCommand('vscode.openWith', fileUri, SqlEditorProvider.viewType);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.VIEW_TABLE_DATA, (node) => {
      const n = node as { connectionId: string; tableName: string; schema?: string; database?: string };
      panelManager.openTableData(n.connectionId, n.tableName, n.schema, n.database);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.EDIT_TABLE_DATA, (node) => {
      const n = node as { connectionId: string; tableName: string; schema?: string; database?: string };
      panelManager.openTableData(n.connectionId, n.tableName, n.schema, n.database);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.SHOW_DDL, (node) => {
      const n = node as { connectionId: string; tableName: string; schema?: string; database?: string };
      panelManager.showDDL(n.connectionId, n.tableName, n.schema, n.database);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.EXPORT_TABLE, (node) => {
      const n = node as { connectionId: string; tableName: string; schema?: string; database?: string };
      panelManager.exportTable(n.connectionId, n.tableName, n.schema, n.database);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.EDIT_CONNECTION, (node) => {
      panelManager.openConnectionDialog((node as { connectionId: string }).connectionId);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.DELETE_CONNECTION, async (node) => {
      const n = node as { connectionId: string; label: string };
      const confirm = await vscode.window.showWarningMessage(
        `Delete connection "${n.label}"?`,
        { modal: true },
        'Delete',
      );
      if (confirm === 'Delete') {
        await connectionManager.deleteConnection(n.connectionId);
        treeProvider.refresh();
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.DROP_TABLE, async (node) => {
      const n = node as { connectionId: string; tableName: string; schema?: string; database?: string };
      const confirm = await vscode.window.showWarningMessage(
        `Drop table "${n.tableName}"? This action cannot be undone.`,
        { modal: true },
        'Drop',
      );
      if (confirm === 'Drop') {
        try {
          const adapter = connectionManager.getAdapter(n.connectionId);
          if (!adapter || !('execute' in adapter)) {
            vscode.window.showErrorMessage('No active connection for this table.');
            return;
          }
          const config = connectionManager.getConnection(n.connectionId);
          const dbType = config?.type ?? 'postgresql';
          const q = (name: string) =>
            dbType === 'mysql' || dbType === 'mariadb'
              ? '`' + name.replace(/`/g, '``') + '`'
              : '"' + name.replace(/"/g, '""') + '"';
          const qualifiedName = n.schema
            ? `${q(n.schema)}.${q(n.tableName)}`
            : q(n.tableName);
          await adapter.execute(`DROP TABLE ${qualifiedName}`);
          vscode.window.showInformationMessage(`Table "${n.tableName}" has been dropped.`);
          treeProvider.refresh();
        } catch (err) {
          vscode.window.showErrorMessage(`Drop table failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.VIEW_REDIS_DATA, (node) => {
      const n = node as { connectionId: string; redisDb?: number };
      panelManager.openRedisBrowser(n.connectionId, n.redisDb);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.OPEN_SQL_FILE, async (uri?: vscode.Uri) => {
      // Resolve file URI: from explorer context menu or from active editor
      let fileUri = uri;
      if (!fileUri) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.languageId === 'sql') {
          fileUri = activeEditor.document.uri;
        }
      }
      if (!fileUri) {
        vscode.window.showWarningMessage('No SQL file selected.');
        return;
      }

      // Open with our custom SQL editor
      await vscode.commands.executeCommand('vscode.openWith', fileUri, SqlEditorProvider.viewType);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.BACKUP_DATABASE, (node) => {
      const n = node as { connectionId: string; database?: string };
      if (!n.database) {
        vscode.window.showErrorMessage('No database selected for backup.');
        return;
      }
      void backupService.backupDatabase(n.connectionId, n.database);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.RESTORE_DATABASE, (node) => {
      const n = node as { connectionId: string; database?: string };
      if (!n.database) {
        vscode.window.showErrorMessage('No database selected for restore.');
        return;
      }
      void backupService.restoreDatabase(n.connectionId, n.database, () => {
        treeProvider.refresh();
      });
    }),
    vscode.commands.registerCommand(COMMAND_IDS.CREATE_DATABASE, async (node) => {
      const n = node as { connectionId: string };
      const config = connectionManager.getConnection(n.connectionId);
      if (!config || config.type === 'sqlite' || config.type === 'redis') {
        vscode.window.showErrorMessage('Create database is not supported for this connection type.');
        return;
      }
      const adapter = connectionManager.getAdapter(n.connectionId);
      if (!adapter || !('execute' in adapter)) {
        vscode.window.showErrorMessage('No active connection.');
        return;
      }
      const dbName = await vscode.window.showInputBox({
        title: 'Create Database',
        prompt: 'Enter the new database name',
        placeHolder: 'my_database',
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? null : 'Database name is required'),
      });
      if (!dbName) return;
      try {
        const q = config.type === 'mysql' || config.type === 'mariadb'
          ? '`' + dbName.replace(/`/g, '``') + '`'
          : '"' + dbName.replace(/"/g, '""') + '"';
        await adapter.execute(`CREATE DATABASE ${q}`);
        vscode.window.showInformationMessage(`Database "${dbName}" created.`);
        treeProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Create database failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.DROP_DATABASE, async (node) => {
      const n = node as { connectionId: string; database?: string };
      if (!n.database) {
        vscode.window.showErrorMessage('No database selected.');
        return;
      }
      const config = connectionManager.getConnection(n.connectionId);
      if (!config) {
        vscode.window.showErrorMessage('Connection not found.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Drop database "${n.database}"? All data will be permanently deleted. This action cannot be undone.`,
        { modal: true },
        'Drop',
      );
      if (confirm !== 'Drop') return;
      try {
        const adapter = connectionManager.getAdapter(n.connectionId);
        if (!adapter || !('execute' in adapter)) {
          vscode.window.showErrorMessage('No active connection.');
          return;
        }
        const q = config.type === 'mysql' || config.type === 'mariadb'
          ? '`' + n.database.replace(/`/g, '``') + '`'
          : '"' + n.database.replace(/"/g, '""') + '"';
        // PostgreSQL: can't drop current database — switch to 'postgres' first
        if (config.type === 'postgresql') {
          const pgAdapter = adapter as typeof adapter & { switchDatabase?(db: string): Promise<void> };
          if (pgAdapter.switchDatabase) {
            await pgAdapter.switchDatabase('postgres');
          }
        }
        await adapter.execute(`DROP DATABASE ${q}`);
        vscode.window.showInformationMessage(`Database "${n.database}" has been dropped.`);
        treeProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Drop database failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
}

export function deactivate(): void {
  connectionManager?.dispose();
  panelManager?.dispose();
}
