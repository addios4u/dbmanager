import React, { useCallback, useEffect, useRef } from 'react';
import * as l10n from '@vscode/l10n';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import { useQueryStore } from '../../stores/query';
import { useConnectionStore } from '../../stores/connection';
import { postMessage } from '../../vscode-api';

interface QueryEditorProps {
  connectionId: string;
}

export function QueryEditor({ connectionId }: QueryEditorProps) {
  const { sql, isExecuting, setSql, setExecuting } = useQueryStore();
  const { connections } = useConnectionStore();
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const executeRef = useRef<() => void>(() => {});

  const activeConnection = connections.find((c) => c.id === connectionId);

  const executeQuery = useCallback(() => {
    const { sql: currentSql, isExecuting: busy } = useQueryStore.getState();
    if (busy) return;

    // Use selected text if any, otherwise full SQL
    let sqlToRun = currentSql;
    const ed = editorRef.current;
    if (ed) {
      const selection = ed.getSelection();
      if (selection && !selection.isEmpty()) {
        const model = ed.getModel();
        if (model) {
          sqlToRun = model.getValueInRange(selection);
        }
      }
    }

    if (!sqlToRun.trim()) return;
    const queryId = `q-${Date.now()}`;
    useQueryStore.getState().setExecuting(true, queryId);
    postMessage({ type: 'executeQuery', connectionId, sql: sqlToRun });
  }, [connectionId]);

  // Keep ref in sync so the Monaco command always calls latest version
  useEffect(() => {
    executeRef.current = executeQuery;
  }, [executeQuery]);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      // Ctrl+Enter / Cmd+Enter to execute (selected text or all)
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => {
          executeRef.current();
        },
      );
      // Ctrl+S / Cmd+S to save query to file
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => {
          const content = editor.getValue();
          if (content.trim()) {
            postMessage({ type: 'saveQueryToFile', content });
          }
        },
      );
    },
    [],
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
          title={l10n.t('Execute query (Ctrl+Enter) — runs selected text if any')}
          style={{ opacity: isExecuting || !sql.trim() ? 0.5 : 1 }}
        >
          {isExecuting ? l10n.t('Running...') : l10n.t('Run')}
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
            {l10n.t('Cancel')}
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          language="sql"
          value={sql}
          onChange={(value) => {
            const v = value ?? '';
            setSql(v);
            // Sync to TextDocument for CustomEditor
            postMessage({ type: 'documentChange', content: v });
          }}
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
