import React, { useCallback, useEffect, useRef } from 'react';
import * as l10n from '@vscode/l10n';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as monacoEditor, Range as MonacoRange } from 'monaco-editor';
import { useQueryStore } from '../../stores/query';
import { useConnectionStore } from '../../stores/connection';
import { useAiStore } from '../../stores/ai';
import { postMessage } from '../../vscode-api';
import { AIQueryPanel } from '../AIQueryPanel';

// 삽입된 SQL 텍스트를 Monaco 에디터에서 자동 선택한다.
function selectSql(editor: monacoEditor.IStandaloneCodeEditor, sql: string): void {
  const model = editor.getModel();
  if (!model || !sql) return;
  const content = model.getValue();
  const idx = content.lastIndexOf(sql);
  if (idx === -1) return;
  const start = model.getPositionAt(idx);
  const end = model.getPositionAt(idx + sql.length);
  const range = {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
  editor.setSelection(range);
  editor.revealRange(range);
  editor.focus();
}

// 파일 상단의 연속된 주석 블록(-- 또는 블록 주석)을 추출해 반환한다.
function extractHeaderComments(sql: string): string {
  const lines = sql.split('\n');
  const headerLines: string[] = [];
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (inBlockComment) {
      headerLines.push(line);
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }

    if (trimmed.startsWith('--') || trimmed === '') {
      headerLines.push(line);
    } else if (trimmed.startsWith('/*')) {
      inBlockComment = true;
      headerLines.push(line);
      if (trimmed.includes('*/')) inBlockComment = false;
    } else {
      break;
    }
  }

  // 끝의 빈 줄 제거
  while (headerLines.length > 0 && headerLines[headerLines.length - 1]?.trim() === '') {
    headerLines.pop();
  }

  return headerLines.join('\n');
}

interface QueryEditorProps {
  connectionId: string;
}

export function QueryEditor({ connectionId }: QueryEditorProps) {
  const { sql, isExecuting, setSql, setExecuting } = useQueryStore();
  const { connections } = useConnectionStore();
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const executeRef = useRef<() => void>(() => {});

  const isPanelOpen = useAiStore((s) => s.isPanelOpen);
  const pendingResult = useAiStore((s) => s.pendingResult);
  const insertMode = useAiStore((s) => s.insertMode);
  const setPanelOpen = useAiStore((s) => s.setPanelOpen);
  const setMode = useAiStore((s) => s.setMode);
  const setSelectedSql = useAiStore((s) => s.setSelectedSql);
  const setPendingResult = useAiStore((s) => s.setPendingResult);

  const activeConnection = connections.find((c) => c.id === connectionId);

  // Apply AI result to Monaco editor whenever pendingResult is set
  useEffect(() => {
    if (!pendingResult || !editorRef.current) return;

    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return;

    const { sql: newSql, mode } = pendingResult;

    if (mode === 'refine') {
      // Replace the current selection with the refined SQL
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        editor.executeEdits('ai-refine', [{ range: selection, text: newSql, forceMoveMarkers: true }]);
      } else {
        // No selection: replace entire content but keep header comments
        const header = extractHeaderComments(model.getValue());
        const fullRange = model.getFullModelRange();
        const replacement = header ? header + '\n\n' + newSql : newSql;
        editor.executeEdits('ai-refine', [{ range: fullRange, text: replacement, forceMoveMarkers: true }]);
      }
    } else if (insertMode === 'append') {
      const lineCount = model.getLineCount();
      const lastCol = model.getLineMaxColumn(lineCount);
      const endPos = { lineNumber: lineCount, column: lastCol };
      editor.executeEdits('ai-generate', [
        {
          range: { startLineNumber: lineCount, startColumn: lastCol, endLineNumber: lineCount, endColumn: lastCol } as MonacoRange,
          text: '\n\n' + newSql,
          forceMoveMarkers: true,
        },
      ]);
      editor.revealPosition(endPos);
    } else {
      // Replace entire content but preserve header comments
      const header = extractHeaderComments(model.getValue());
      const fullRange = model.getFullModelRange();
      const replacement = header ? header + '\n\n' + newSql : newSql;
      editor.executeEdits('ai-generate', [{ range: fullRange, text: replacement, forceMoveMarkers: true }]);
    }

    setSql(editor.getValue());
    setPendingResult(null);

    // 삽입된 SQL 텍스트를 자동 선택
    selectSql(editor, newSql);
  }, [pendingResult, insertMode, setSql, setPendingResult]);

  // Request key status on mount so the indicator is accurate
  useEffect(() => {
    postMessage({ type: 'aiGetKeyStatus', provider: 'openai' });
    postMessage({ type: 'aiGetKeyStatus', provider: 'google' });
  }, []);

  const activeConnection2 = activeConnection; // avoid shadowing warning

  const executeQuery = useCallback(() => {
    const { sql: currentSql, isExecuting: busy } = useQueryStore.getState();
    if (busy) return;

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

  useEffect(() => {
    executeRef.current = executeQuery;
  }, [executeQuery]);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Ctrl+Enter / Cmd+Enter to execute
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        executeRef.current();
      });

      // Ctrl+V / Cmd+V paste workaround
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, async () => {
        try {
          const text = await navigator.clipboard.readText();
          const selection = editor.getSelection();
          if (selection) {
            editor.executeEdits('paste', [{ range: selection, text, forceMoveMarkers: true }]);
          }
        } catch {
          // fallback
        }
      });

      // Ctrl+S / Cmd+S to save
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        const content = editor.getValue();
        if (content.trim()) {
          postMessage({ type: 'saveQueryToFile', content });
        }
      });

      // Track selection changes → sync to AI Refine mode
      editor.onDidChangeCursorSelection(() => {
        const sel = editor.getSelection();
        const model = editor.getModel();
        if (sel && !sel.isEmpty() && model) {
          const text = model.getValueInRange(sel);
          setSelectedSql(text);
          setMode('refine');
        } else {
          setSelectedSql('');
          setMode('generate');
        }
      });
    },
    [setSelectedSql, setMode],
  );

  const isDark =
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
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
          {activeConnection2 ? activeConnection2.name : connectionId}
        </span>
        <span style={{ flex: 1 }} />

        {/* AI toggle */}
        <button
          onClick={() => setPanelOpen(!isPanelOpen)}
          title={isPanelOpen ? l10n.t('Close AI panel') : l10n.t('Open AI Query Generator')}
          style={{
            opacity: 1,
            background: isPanelOpen ? 'var(--vscode-button-background)' : 'none',
            color: isPanelOpen ? 'var(--vscode-button-foreground)' : 'inherit',
            border: isPanelOpen ? 'none' : '1px solid var(--vscode-panel-border)',
            borderRadius: 3,
            padding: '2px 8px',
            fontSize: 12,
          }}
        >
          ✨ AI
        </button>

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

      {/* AI Panel (collapsible) */}
      {isPanelOpen && (
        <AIQueryPanel connectionId={connectionId} />
      )}

      {/* Monaco Editor */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          language="sql"
          value={sql}
          onChange={(value) => {
            const v = value ?? '';
            setSql(v);
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
