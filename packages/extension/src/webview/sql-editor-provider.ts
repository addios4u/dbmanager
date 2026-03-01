import * as vscode from 'vscode';
import type { WebviewMessage, ExtensionMessage, PanelMeta } from '@dbmanager/shared';
import type { WebviewPanelManager } from './panel-manager.js';

/**
 * CustomTextEditorProvider for .sql files.
 *
 * Opens .sql files in a query viewer (Monaco + context selector + results grid)
 * instead of the default text editor. Bidirectional sync between TextDocument
 * and the webview Monaco editor.
 */
export class SqlEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'dbmanager.sqlEditor';

  constructor(
    private readonly panelManager: WebviewPanelManager,
  ) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    const context = this.panelManager.context;

    // Configure webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
      ],
    };

    // Parse metadata header comment from file content (e.g. "-- DBManager: ConnName (type) | Database: db | Schema: sc")
    const connInfos = this.panelManager.connectionManager.getConnectionInfos();
    const headerMatch = document.getText().match(
      /^-- DBManager:\s*(.+?)\s*\((\w+)\)(?:\s*\|\s*Database:\s*(\S+))?(?:\s*\|\s*Schema:\s*(\S+))?/,
    );

    let connectionId: string | undefined;
    let database: string | undefined;
    let schema: string | undefined;

    if (headerMatch) {
      // Resolve connection by name + type from header
      const connName = headerMatch[1];
      const connType = headerMatch[2];
      const matched = connInfos.find((c) => c.name === connName && c.type === connType)
        ?? connInfos.find((c) => c.name === connName);
      if (matched) {
        connectionId = matched.id;
        database = headerMatch[3];
        schema = headerMatch[4];
      }
    }

    // No header → no auto-connect (user must select connection manually)

    const meta: PanelMeta = {
      kind: 'query',
      connectionId,
      database,
      schema,
      initialSql: document.getText(),
    };

    // Render webview HTML
    const nonce = this.panelManager.getNonce();
    webviewPanel.webview.html = this.panelManager.getWebviewContent(
      webviewPanel.webview,
      nonce,
      meta,
    );

    // --- Bidirectional sync ---

    // Prevent infinite update loops
    let isUpdatingFromExtension = false;
    let isUpdatingFromWebview = false;

    // Document → Webview: push document changes to webview
    const docChangeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (isUpdatingFromWebview) return;

      isUpdatingFromExtension = true;
      const content = document.getText();
      const msg: ExtensionMessage = { type: 'documentContent', content };
      void webviewPanel.webview.postMessage(msg);
      // Reset flag after a tick to allow next change
      setTimeout(() => { isUpdatingFromExtension = false; }, 0);
    });

    // Webview → Document: apply webview changes to document
    const messageSubscription = webviewPanel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => {
        if (msg.type === 'documentChange') {
          if (isUpdatingFromExtension) return;

          isUpdatingFromWebview = true;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            msg.content,
          );
          void vscode.workspace.applyEdit(edit).then(() => {
            isUpdatingFromWebview = false;
          });
          return;
        }

        // Ctrl+S: save document
        if (msg.type === 'saveQueryToFile') {
          void document.save();
          return;
        }

        // All other messages: delegate to panel manager
        this.panelManager.handleMessage(webviewPanel, meta, msg);
      },
    );

    // Cleanup on dispose
    webviewPanel.onDidDispose(() => {
      docChangeSubscription.dispose();
      messageSubscription.dispose();
    });
  }
}
