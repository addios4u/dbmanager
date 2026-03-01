import React, { useCallback, useEffect, useState } from 'react';
import * as l10n from '@vscode/l10n';
import type { RedisValue } from '@dbmanager/shared';
import { TTLEditor } from './TTLEditor';

interface ValueViewerProps {
  value: RedisValue | null;
  isLoading: boolean;
  onSave: (key: string, value: string, ttl?: number) => void;
  onDelete: (key: string) => void;
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  string: 'rgba(76, 175, 80, 0.2)',
  list: 'rgba(33, 150, 243, 0.2)',
  set: 'rgba(156, 39, 176, 0.2)',
  zset: 'rgba(255, 152, 0, 0.2)',
  hash: 'rgba(0, 150, 136, 0.2)',
};

const TYPE_BADGE_TEXT_COLORS: Record<string, string> = {
  string: '#4caf50',
  list: '#2196f3',
  set: '#9c27b0',
  zset: '#ff9800',
  hash: '#009688',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  borderBottom: '1px solid var(--vscode-panel-border)',
  fontWeight: 600,
  opacity: 0.8,
};

const tdStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid var(--vscode-panel-border)',
  verticalAlign: 'top',
  wordBreak: 'break-all',
};

function tryPrettyJson(val: unknown): string {
  if (typeof val !== 'string') return String(val);
  try {
    const parsed = JSON.parse(val);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return val;
  }
}

function isJsonString(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(val);
    return true;
  } catch {
    return false;
  }
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 600,
        background: TYPE_BADGE_COLORS[type] ?? 'rgba(128,128,128,0.2)',
        color: TYPE_BADGE_TEXT_COLORS[type] ?? 'var(--vscode-foreground)',
      }}
    >
      {type}
    </span>
  );
}

function StringValue({ value, onSave }: { value: RedisValue; onSave: (key: string, val: string, ttl?: number) => void }) {
  const raw = typeof value.value === 'string' ? value.value : String(value.value);
  const [text, setText] = useState(() => (isJsonString(raw) ? tryPrettyJson(raw) : raw));

  useEffect(() => {
    setText(isJsonString(raw) ? tryPrettyJson(raw) : raw);
  }, [raw]);

  const handleSave = useCallback(() => {
    onSave(value.key, text);
  }, [value.key, text, onSave]);

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{
          width: '100%',
          minHeight: 100,
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
          fontSize: 12,
          background: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          border: '1px solid var(--vscode-input-border)',
          borderRadius: 2,
          padding: 8,
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ marginTop: 8 }}>
        <button
          onClick={handleSave}
          style={{
            fontSize: 12,
            padding: '3px 10px',
            cursor: 'pointer',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: 2,
          }}
        >
          {l10n.t('Save')}
        </button>
      </div>
    </div>
  );
}

function ListValue({ value }: { value: RedisValue }) {
  const items = Array.isArray(value.value) ? (value.value as unknown[]) : [];
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>{l10n.t('{0} items', items.length)}</div>
      <ol style={{ margin: 0, paddingLeft: 24 }}>
        {items.map((item, i) => (
          <li
            key={i}
            style={{
              padding: '2px 0',
              fontSize: 12,
              borderBottom: '1px solid var(--vscode-panel-border)',
              wordBreak: 'break-all',
            }}
          >
            {String(item)}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SetValue({ value }: { value: RedisValue }) {
  const members = Array.isArray(value.value) ? (value.value as unknown[]) : [];
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>{l10n.t('{0} members', members.length)}</div>
      <ul style={{ margin: 0, paddingLeft: 24 }}>
        {members.map((m, i) => (
          <li
            key={i}
            style={{
              padding: '2px 0',
              fontSize: 12,
              borderBottom: '1px solid var(--vscode-panel-border)',
              wordBreak: 'break-all',
            }}
          >
            {String(m)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ZSetValue({ value }: { value: RedisValue }) {
  const raw = Array.isArray(value.value) ? (value.value as unknown[]) : [];
  const pairs: Array<{ member: string; score: string }> = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    pairs.push({ member: String(raw[i]), score: String(raw[i + 1]) });
  }
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>{l10n.t('Member')}</th>
          <th style={thStyle}>{l10n.t('Score')}</th>
        </tr>
      </thead>
      <tbody>
        {pairs.map((p, i) => (
          <tr key={i}>
            <td style={tdStyle}>{p.member}</td>
            <td style={tdStyle}>{p.score}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HashValue({ value }: { value: RedisValue }) {
  const entries =
    value.value !== null && typeof value.value === 'object'
      ? Object.entries(value.value as Record<string, unknown>)
      : [];
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>{l10n.t('Field')}</th>
          <th style={thStyle}>{l10n.t('Value')}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([field, val], i) => (
          <tr key={i}>
            <td style={{ ...tdStyle, fontWeight: 600 }}>{field}</td>
            <td style={tdStyle}>{String(val)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ValueViewer({ value, isLoading, onSave, onDelete }: ValueViewerProps) {
  const handleSetTTL = useCallback(
    (ttl: number) => {
      if (!value) return;
      // Persist TTL via save with existing value
      const raw = typeof value.value === 'string' ? value.value : JSON.stringify(value.value);
      onSave(value.key, raw, ttl);
    },
    [value, onSave],
  );

  const handleDelete = useCallback(() => {
    if (!value) return;
    onDelete(value.key);
  }, [value, onDelete]);

  if (isLoading) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          opacity: 0.6,
        }}
      >
        {l10n.t('Loading...')}
      </div>
    );
  }

  if (!value) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          opacity: 0.6,
        }}
      >
        {l10n.t('Select a key to view its value')}
      </div>
    );
  }

  return (
    <div style={{ padding: 16, overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            wordBreak: 'break-all',
            flex: 1,
            minWidth: 0,
          }}
        >
          {value.key}
        </h3>
        <TypeBadge type={value.type} />
        <TTLEditor ttl={value.ttl} onSetTTL={handleSetTTL} />
      </div>

      <div style={{ marginBottom: 12 }}>
        {value.type === 'string' && <StringValue value={value} onSave={onSave} />}
        {value.type === 'list' && <ListValue value={value} />}
        {value.type === 'set' && <SetValue value={value} />}
        {value.type === 'zset' && <ZSetValue value={value} />}
        {value.type === 'hash' && <HashValue value={value} />}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleDelete}
          style={{
            fontSize: 12,
            padding: '3px 10px',
            cursor: 'pointer',
            background: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
            border: 'none',
            borderRadius: 2,
          }}
        >
          {l10n.t('Delete')}
        </button>
      </div>
    </div>
  );
}
