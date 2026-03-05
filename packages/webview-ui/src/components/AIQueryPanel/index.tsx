import React, { useState, useCallback } from 'react';
import { useAiStore } from '../../stores/ai';
import { postMessage } from '../../vscode-api';
import { useConnectionStore } from '../../stores/connection';
import { AISettingsDialog } from '../AISettingsDialog/index';

interface AIQueryPanelProps {
  connectionId: string;
}

export function AIQueryPanel({ connectionId }: AIQueryPanelProps) {
  const provider = useAiStore((s) => s.provider);
  const mode = useAiStore((s) => s.mode);
  const prompt = useAiStore((s) => s.prompt);
  const instruction = useAiStore((s) => s.instruction);
  const selectedSql = useAiStore((s) => s.selectedSql);
  const insertMode = useAiStore((s) => s.insertMode);
  const isGenerating = useAiStore((s) => s.isGenerating);
  const error = useAiStore((s) => s.error);
  const keyStatus = useAiStore((s) => s.keyStatus);
  const setProvider = useAiStore((s) => s.setProvider);
  const setMode = useAiStore((s) => s.setMode);
  const setPrompt = useAiStore((s) => s.setPrompt);
  const setInstruction = useAiStore((s) => s.setInstruction);
  const setInsertMode = useAiStore((s) => s.setInsertMode);
  const setGenerating = useAiStore((s) => s.setGenerating);
  const setError = useAiStore((s) => s.setError);

  const [showSettings, setShowSettings] = useState(false);

  const { connections } = useConnectionStore();
  const connection = connections.find((c) => c.id === connectionId);

  // Listen for AI results via the store (set by useExtensionMessages)
  // The parent QueryEditor will call onApplyResult when it receives aiQueryResult

  const handleGenerate = useCallback(() => {
    if (!prompt.trim() || isGenerating) return;
    setGenerating(true);
    setError(null);
    postMessage({ type: 'aiGenerateQuery', connectionId, prompt: prompt.trim(), provider });
  }, [prompt, isGenerating, connectionId, provider, setGenerating, setError]);

  const handleRefine = useCallback(() => {
    if (!selectedSql.trim() || isGenerating) return;
    setGenerating(true);
    setError(null);
    postMessage({
      type: 'aiRefineQuery',
      connectionId,
      sql: selectedSql.trim(),
      instruction: instruction.trim() || undefined,
      provider,
    });
  }, [selectedSql, instruction, isGenerating, connectionId, provider, setGenerating, setError]);

  const hasKey = keyStatus[provider];
  const dbType = connection?.type ?? 'unknown';

  const panelStyle: React.CSSProperties = {
    borderBottom: '1px solid var(--vscode-panel-border, #333)',
    background: 'var(--vscode-editorGroupHeader-tabsBackground)',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    opacity: 0.7,
    marginBottom: 2,
  };

  const textareaStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: 3,
    padding: '6px 8px',
    fontSize: 12,
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  const preStyle: React.CSSProperties = {
    background: 'var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1))',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: 3,
    padding: '6px 8px',
    fontSize: 11,
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: 80,
    overflow: 'auto',
    margin: 0,
  };

  return (
    <div style={panelStyle}>
      <style>{`
        @keyframes ai-spin {
          to { transform: rotate(360deg); }
        }
        .ai-spinner {
          display: inline-block;
          width: 12px;
          height: 12px;
          border: 2px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: ai-spin 0.7s linear infinite;
          vertical-align: middle;
          margin-right: 6px;
          opacity: 0.8;
        }
      `}</style>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>✨ AI Query</span>
        <span style={{ flex: 1 }} />

        {/* Provider selector */}
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as 'openai' | 'google')}
          style={{ fontSize: 11, padding: '2px 4px' }}
        >
          <option value="openai">OpenAI</option>
          <option value="google">Google</option>
        </select>

        {/* API key status + settings */}
        <button
          onClick={() => setShowSettings(true)}
          title="Configure API Key"
          style={{
            fontSize: 12,
            padding: '2px 6px',
            background: 'none',
            border: '1px solid var(--vscode-panel-border)',
            borderRadius: 3,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          ⚙
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: hasKey ? '#4caf50' : '#f44336',
            }}
          />
        </button>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--vscode-panel-border)' }}>
        {(['generate', 'refine'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: mode === m ? '2px solid var(--vscode-focusBorder, #007acc)' : '2px solid transparent',
              padding: '4px 12px',
              fontSize: 12,
              cursor: 'pointer',
              opacity: mode === m ? 1 : 0.6,
              fontWeight: mode === m ? 600 : 400,
              marginBottom: -1,
            }}
          >
            {m === 'generate' ? 'Generate' : 'Refine'}
          </button>
        ))}
        <span style={{ fontSize: 11, opacity: 0.5, alignSelf: 'center', marginLeft: 8 }}>
          {dbType}
        </span>
      </div>

      {/* Generate mode */}
      {mode === 'generate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div style={labelStyle}>Prompt</div>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the query you want to generate..."
              style={textareaStyle}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate();
              }}
            />
          </div>

          {/* Insert mode */}
          <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="radio"
                checked={insertMode === 'replace'}
                onChange={() => setInsertMode('replace')}
              />
              Replace editor
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="radio"
                checked={insertMode === 'append'}
                onChange={() => setInsertMode('append')}
              />
              Append to editor
            </label>
          </div>

          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating || !hasKey}
            style={{ alignSelf: 'flex-start' }}
            title={!hasKey ? 'API key not configured' : undefined}
          >
            {isGenerating ? <><span className="ai-spinner" />Generating…</> : '✨ Generate'}
          </button>
        </div>
      )}

      {/* Refine mode */}
      {mode === 'refine' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div style={labelStyle}>
              Selected SQL
              {!selectedSql && (
                <span style={{ color: 'var(--vscode-editorWarning-foreground, orange)', marginLeft: 6 }}>
                  — select text in editor
                </span>
              )}
            </div>
            {selectedSql ? (
              <pre style={preStyle}>{selectedSql}</pre>
            ) : (
              <div style={{ ...preStyle, opacity: 0.4, fontFamily: 'inherit', fontSize: 12 }}>
                No text selected
              </div>
            )}
          </div>

          <div>
            <div style={labelStyle}>Instruction (optional)</div>
            <textarea
              rows={2}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. Use proper aliases, add pagination, fix column names..."
              style={textareaStyle}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleRefine();
              }}
            />
          </div>

          <button
            onClick={handleRefine}
            disabled={!selectedSql.trim() || isGenerating || !hasKey}
            style={{ alignSelf: 'flex-start' }}
            title={!hasKey ? 'API key not configured' : undefined}
          >
            {isGenerating ? <><span className="ai-spinner" />Refining…</> : '✨ Refine'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--vscode-editorError-foreground, #f44336)',
            background: 'rgba(244,67,54,0.08)',
            borderRadius: 3,
            padding: '6px 8px',
          }}
        >
          {error}
        </div>
      )}

      {/* Settings dialog */}
      {showSettings && (
        <AISettingsDialog
          provider={provider}
          hasKey={hasKey}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
