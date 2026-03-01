import React, { useCallback, useState } from 'react';
import * as l10n from '@vscode/l10n';

interface TTLEditorProps {
  ttl: number;
  onSetTTL: (ttl: number) => void;
}

export function TTLEditor({ ttl, onSetTTL }: TTLEditorProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(String(ttl));

  const handleClick = useCallback(() => {
    setInputValue(String(ttl));
    setEditing(true);
  }, [ttl]);

  const handleSet = useCallback(() => {
    const parsed = parseInt(inputValue, 10);
    if (!isNaN(parsed)) {
      onSetTTL(parsed);
    }
    setEditing(false);
  }, [inputValue, onSetTTL]);

  const handleCancel = useCallback(() => {
    setEditing(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleSet();
      if (e.key === 'Escape') handleCancel();
    },
    [handleSet, handleCancel],
  );

  const displayText = ttl === -1 ? l10n.t('No expiry') : l10n.t('TTL: {0}s', ttl);

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
        <input
          type="number"
          min={-1}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          style={{
            width: 72,
            fontSize: 11,
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
            borderRadius: 2,
            padding: '1px 4px',
          }}
        />
        <button
          onClick={handleSet}
          style={{
            fontSize: 11,
            padding: '1px 6px',
            cursor: 'pointer',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: 2,
          }}
        >
          {l10n.t('Set')}
        </button>
        <button
          onClick={handleCancel}
          style={{
            fontSize: 11,
            padding: '1px 6px',
            cursor: 'pointer',
            background: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
            border: 'none',
            borderRadius: 2,
          }}
        >
          {l10n.t('Cancel')}
        </button>
      </span>
    );
  }

  return (
    <span
      onClick={handleClick}
      title={l10n.t('Click to edit TTL')}
      style={{
        fontSize: 11,
        opacity: 0.7,
        cursor: 'pointer',
        padding: '1px 4px',
        borderRadius: 2,
        userSelect: 'none',
      }}
    >
      {displayText}
    </span>
  );
}
