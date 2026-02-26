import * as vscode from 'vscode';
import type { WebviewMessage, ExtensionMessage, ConnectionConfig } from '@dbmanager/shared';
import type { ConnectionManager } from '../services/connection-manager.js';

type PanelKind = 'query' | 'tableData' | 'tableEditor' | 'connectionDialog' | 'ddl' | 'export';

interface PanelMeta {
  kind: PanelKind;
  connectionId?: string;
  tableName?: string;
  schema?: string;
  editId?: string;
}

export class WebviewPanelManager {
  private readonly context: vscode.ExtensionContext;
  private readonly connectionManager: ConnectionManager;
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(context: vscode.ExtensionContext, connectionManager: ConnectionManager) {
    this.context = context;
    this.connectionManager = connectionManager;
  }

  openQueryEditor(connectionId: string): void {
    const key = `query:${connectionId}`;
    this.showOrCreate(key, `Query — ${this.getConnectionLabel(connectionId)}`, { kind: 'query', connectionId });
  }

  openTableData(connectionId: string, tableName: string, schema?: string): void {
    const key = `tableData:${connectionId}:${schema ?? ''}:${tableName}`;
    this.showOrCreate(key, `${tableName} — Data`, { kind: 'tableData', connectionId, tableName, schema });
  }

  openTableEditor(connectionId: string, tableName: string, schema?: string): void {
    const key = `tableEditor:${connectionId}:${schema ?? ''}:${tableName}`;
    this.showOrCreate(key, `${tableName} — Edit`, { kind: 'tableEditor', connectionId, tableName, schema });
  }

  openConnectionDialog(editId?: string): void {
    const key = editId ? `connectionDialog:${editId}` : 'connectionDialog:new';
    const title = editId ? 'Edit Connection' : 'New Connection';
    this.showOrCreate(key, title, { kind: 'connectionDialog', editId });
  }

  showDDL(connectionId: string, tableName: string, schema?: string): void {
    const key = `ddl:${connectionId}:${schema ?? ''}:${tableName}`;
    this.showOrCreate(key, `${tableName} — DDL`, { kind: 'ddl', connectionId, tableName, schema });
  }

  exportTable(connectionId: string, tableName: string): void {
    const key = `export:${connectionId}:${tableName}`;
    this.showOrCreate(key, `${tableName} — Export`, { kind: 'export', connectionId, tableName });
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

  private handleMessage(panel: vscode.WebviewPanel, meta: PanelMeta, msg: WebviewMessage): void {
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
        break;
      }

      case 'executeQuery': {
        // TODO: delegate to QueryExecutor service
        const errMsg: ExtensionMessage = {
          type: 'queryError',
          queryId: msg.sql,
          error: 'Query executor not yet implemented',
        };
        void panel.webview.postMessage(errMsg);
        break;
      }

      case 'testConnection': {
        // TODO: delegate to ConnectionManager
        const resultMsg: ExtensionMessage = {
          type: 'connectionTestResult',
          success: false,
          error: 'Test connection not yet implemented',
        };
        void panel.webview.postMessage(resultMsg);
        break;
      }

      case 'saveConnection': {
        void this.handleSaveConnection(panel, msg.config);
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
        // TODO: delegate to adapter
        const errMsg: ExtensionMessage = {
          type: 'error',
          message: 'getTableData not yet implemented',
        };
        void panel.webview.postMessage(errMsg);
        break;
      }

      case 'getTableDDL': {
        // TODO: delegate to adapter
        const errMsg: ExtensionMessage = {
          type: 'error',
          message: 'getTableDDL not yet implemented',
        };
        void panel.webview.postMessage(errMsg);
        break;
      }

      case 'exportData': {
        // TODO: implement export
        break;
      }

      case 'redisScan': {
        // TODO: delegate to Redis adapter
        break;
      }

      case 'redisGet': {
        // TODO: delegate to Redis adapter
        break;
      }

      case 'redisSet': {
        // TODO: delegate to Redis adapter
        break;
      }

      case 'redisDel': {
        // TODO: delegate to Redis adapter
        break;
      }

      default:
        break;
    }
  }

  private async handleSaveConnection(panel: vscode.WebviewPanel, config: ConnectionConfig): Promise<void> {
    try {
      await this.connectionManager.saveConnection(config);
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

  private getWebviewContent(webview: vscode.Webview, nonce: string, meta: PanelMeta): string {
    const webviewDistUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDistUri, 'index.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDistUri, 'index.css'));

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    const initialState = JSON.stringify({ meta });

    return `<!DOCTYPE html>
<html lang="en">
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

  private getNonce(): string {
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
