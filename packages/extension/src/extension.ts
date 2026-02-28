import * as vscode from 'vscode';
import { ConnectionManager } from './services/connection-manager.js';
import { DatabaseTreeProvider } from './providers/database-tree.js';
import { WebviewPanelManager } from './webview/panel-manager.js';
import { COMMAND_IDS, VIEW_IDS } from '@dbmanager/shared';

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
    vscode.commands.registerCommand(COMMAND_IDS.NEW_QUERY, (node) => {
      const n = node as { connectionId: string; database?: string };
      panelManager.openQueryEditor(n.connectionId, n.database);
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
      const n = node as { connectionId: string; tableName: string };
      const confirm = await vscode.window.showWarningMessage(
        `Drop table "${n.tableName}"? This action cannot be undone.`,
        { modal: true },
        'Drop',
      );
      if (confirm === 'Drop') {
        // TODO: Implement drop table via adapter
        vscode.window.showInformationMessage(`Drop table "${n.tableName}" is not yet implemented.`);
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

      // Read file content
      const content = await vscode.workspace.fs.readFile(fileUri);
      const sql = Buffer.from(content).toString('utf-8');
      const fileName = fileUri.path.split('/').pop() ?? 'query.sql';

      // Pick connection
      const connInfos = connectionManager.getConnectionInfos();
      if (connInfos.length === 0) {
        vscode.window.showWarningMessage('No database connections configured. Add a connection first.');
        return;
      }

      // Use last-used connection or prompt the user
      const lastConnId = context.globalState.get<string>('dbmanager.lastQueryConnectionId');
      let connectionId = lastConnId && connInfos.some((c) => c.id === lastConnId) ? lastConnId : undefined;

      if (!connectionId) {
        if (connInfos.length === 1) {
          connectionId = connInfos[0]!.id;
        } else {
          const picked = await vscode.window.showQuickPick(
            connInfos.map((c) => ({ label: c.name, description: c.type, id: c.id })),
            { placeHolder: 'Select a database connection for this query' },
          );
          if (!picked) return;
          connectionId = picked.id;
        }
      }

      await context.globalState.update('dbmanager.lastQueryConnectionId', connectionId);
      panelManager.openQueryEditorWithSql(connectionId, sql, fileName);
    }),
  );
}

export function deactivate(): void {
  connectionManager?.dispose();
  panelManager?.dispose();
}
