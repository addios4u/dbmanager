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
    vscode.commands.registerCommand(COMMAND_IDS.REFRESH, () => {
      treeProvider.refresh();
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
      panelManager.openQueryEditor((node as { connectionId: string }).connectionId);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.VIEW_TABLE_DATA, (node) => {
      const n = node as { connectionId: string; tableName: string; schema?: string };
      panelManager.openTableData(n.connectionId, n.tableName, n.schema);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.EDIT_TABLE_DATA, (node) => {
      const n = node as { connectionId: string; tableName: string; schema?: string };
      panelManager.openTableEditor(n.connectionId, n.tableName, n.schema);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.SHOW_DDL, (node) => {
      const n = node as { connectionId: string; tableName: string; schema?: string };
      panelManager.showDDL(n.connectionId, n.tableName, n.schema);
    }),
    vscode.commands.registerCommand(COMMAND_IDS.EXPORT_TABLE, (node) => {
      const n = node as { connectionId: string; tableName: string };
      panelManager.exportTable(n.connectionId, n.tableName);
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
  );
}

export function deactivate(): void {
  connectionManager?.dispose();
  panelManager?.dispose();
}
