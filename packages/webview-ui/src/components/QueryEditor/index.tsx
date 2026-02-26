import React, { useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { useQueryStore } from '../../stores/query';
import { useConnectionStore } from '../../stores/connection';
import { postMessage } from '../../vscode-api';

interface QueryEditorProps {
  connectionId: string;
}

export function QueryEditor({ connectionId }: QueryEditorProps) {
  const { sql, isExecuting, setSql, setExecuting } = useQueryStore();
  const { connections } = useConnectionStore();

  const activeConnection = connections.find((c) => c.id === connectionId);

  const executeQuery = useCallback(() => {
    if (!sql.trim() || isExecuting) return;
    const queryId = `q-${Date.now()}`;
    setExecuting(true, queryId);
    postMessage({ type: 'executeQuery', connectionId, sql });
  }, [sql, isExecuting, connectionId, setExecuting]);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      // Ctrl+Enter / Cmd+Enter で実行
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => {
          executeQuery();
        },
      );
    },
    [executeQuery],
  );

  // VS Code テーマに合わせてMonacoテーマを選択
  const isDark =
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          background: 'var(--vscode-editorGroupHeader-tabsBackground)',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 12, opacity: 0.7 }}>
          {activeConnection ? activeConnection.name : connectionId}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={executeQuery}
          disabled={isExecuting || !sql.trim()}
          title="Execute query (Ctrl+Enter)"
          style={{ opacity: isExecuting || !sql.trim() ? 0.5 : 1 }}
        >
          {isExecuting ? 'Running...' : 'Run'}
        </button>
        {isExecuting && (
          <button
            className="secondary"
            onClick={() => {
              const { queryId } = useQueryStore.getState();
              if (queryId) {
                postMessage({ type: 'cancelQuery', queryId });
                setExecuting(false);
              }
            }}
          >
            Cancel
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          language="sql"
          value={sql}
          onChange={(value) => setSql(value ?? '')}
          theme={isDark ? 'vs-dark' : 'vs'}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 2,
            suggestOnTriggerCharacters: true,
          }}
        />
      </div>
    </div>
  );
}
