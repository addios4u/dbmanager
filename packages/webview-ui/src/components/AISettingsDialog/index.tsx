import React, { useState, useCallback } from 'react';
import type { AiProvider } from '../../stores/ai';
import { postMessage } from '../../vscode-api';

interface AISettingsDialogProps {
  provider: AiProvider;
  hasKey: boolean;
  onClose: () => void;
}

export function AISettingsDialog({ provider, hasKey, onClose }: AISettingsDialogProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const handleSave = useCallback(() => {
    if (!apiKey.trim()) return;
    postMessage({ type: 'aiConfigureKey', provider, action: 'save', key: apiKey.trim() });
    onClose();
  }, [apiKey, provider, onClose]);

  const handleRemove = useCallback(() => {
    postMessage({ type: 'aiConfigureKey', provider, action: 'remove' });
    onClose();
  }, [provider, onClose]);

  const providerLabel = provider === 'openai' ? 'OpenAI (GPT-4o mini)' : 'Google (Gemini 2.0 Flash)';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: 6,
          padding: '20px 24px',
          minWidth: 360,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>AI Settings</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7, fontSize: 16, lineHeight: 1, padding: '0 2px' }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, opacity: 0.7 }}>Provider</label>
          <span style={{ fontSize: 12 }}>{providerLabel}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, opacity: 0.7 }}>API Key</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? '••••••••••••••••' : 'Enter your API key'}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              style={{
                flex: 1,
                background: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: 3,
                padding: '4px 8px',
                fontSize: 12,
              }}
            />
            <button
              onClick={() => setShowKey(!showKey)}
              title={showKey ? 'Hide' : 'Show'}
              style={{ padding: '4px 8px', fontSize: 12 }}
            >
              {showKey ? '🙈' : '👁'}
            </button>
          </div>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Key is stored securely in VSCode SecretStorage
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <button
            onClick={handleRemove}
            disabled={!hasKey}
            className="secondary"
            style={{ opacity: hasKey ? 1 : 0.4 }}
          >
            Remove Key
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="secondary" onClick={onClose}>Cancel</button>
            <button onClick={handleSave} disabled={!apiKey.trim()}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
