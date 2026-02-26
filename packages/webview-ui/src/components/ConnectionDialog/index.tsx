import React, { useState, useCallback } from 'react';
import type { DatabaseType, ConnectionConfig } from '@dbmanager/shared';
import { postMessage } from '../../vscode-api';
import { useConnectionStore } from '../../stores/connection';

interface ConnectionDialogProps {
  editId?: string;
  onClose: () => void;
}

const DATABASE_TYPES: { value: DatabaseType; label: string }[] = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'redis', label: 'Redis' },
];

const DEFAULT_PORTS: Record<DatabaseType, number> = {
  mysql: 3306,
  mariadb: 3306,
  postgresql: 5432,
  sqlite: 0,
  redis: 6379,
};

function emptyConfig(): Omit<ConnectionConfig, 'id'> & { password: string } {
  return {
    name: '',
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    username: '',
    database: '',
    filepath: '',
    group: '',
    color: '',
    password: '',
  };
}

export function ConnectionDialog({ editId, onClose }: ConnectionDialogProps) {
  const { connections } = useConnectionStore();

  const existing = editId ? connections.find((c) => c.id === editId) : undefined;

  const [form, setForm] = useState<Omit<ConnectionConfig, 'id'> & { password: string }>(
    existing
      ? { ...existing, password: '' }
      : emptyConfig(),
  );
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testError, setTestError] = useState<string>('');

  const isSqliteType = form.type === 'sqlite';
  const isRedisType = form.type === 'redis';

  const handleTypeChange = useCallback((type: DatabaseType) => {
    setForm((prev) => ({
      ...prev,
      type,
      port: DEFAULT_PORTS[type] || 0,
    }));
  }, []);

  const handleField = useCallback(
    <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const buildConfig = (): ConnectionConfig => ({
    id: editId ?? `conn-${Date.now()}`,
    name: form.name,
    type: form.type,
    host: isSqliteType ? undefined : form.host,
    port: isSqliteType ? undefined : form.port,
    username: isSqliteType || isRedisType ? undefined : form.username,
    database: isSqliteType ? undefined : form.database,
    filepath: isSqliteType ? form.filepath : undefined,
    group: form.group || undefined,
    color: form.color || undefined,
  });

  const handleTest = useCallback(() => {
    setTestStatus('testing');
    setTestError('');
    postMessage({ type: 'testConnection', config: buildConfig() });
  }, [form, editId]);

  const handleSave = useCallback(() => {
    if (!form.name.trim()) return;
    postMessage({ type: 'saveConnection', config: buildConfig() });
    onClose();
  }, [form, editId, onClose]);

  // Listen for test result via window message
  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as { type: string; success?: boolean; error?: string };
      if (msg.type === 'connectionTestResult') {
        if (msg.success) {
          setTestStatus('ok');
        } else {
          setTestStatus('fail');
          setTestError(msg.error ?? 'Connection failed');
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: 20,
        gap: 14,
        overflowY: 'auto',
        maxWidth: 520,
        margin: '0 auto',
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600 }}>
        {editId ? 'Edit Connection' : 'New Connection'}
      </h2>

      {/* Connection Name */}
      <label style={labelStyle}>
        <span>Name *</span>
        <input
          type="text"
          value={form.name}
          onChange={(e) => handleField('name', e.target.value)}
          placeholder="My Database"
          style={inputStyle}
        />
      </label>

      {/* Type */}
      <label style={labelStyle}>
        <span>Type</span>
        <select
          value={form.type}
          onChange={(e) => handleTypeChange(e.target.value as DatabaseType)}
          style={inputStyle}
        >
          {DATABASE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {/* SQLite: filepath */}
      {isSqliteType ? (
        <label style={labelStyle}>
          <span>File Path *</span>
          <input
            type="text"
            value={form.filepath ?? ''}
            onChange={(e) => handleField('filepath', e.target.value)}
            placeholder="/path/to/database.db"
            style={inputStyle}
          />
        </label>
      ) : (
        <>
          {/* Host */}
          <label style={labelStyle}>
            <span>Host</span>
            <input
              type="text"
              value={form.host ?? ''}
              onChange={(e) => handleField('host', e.target.value)}
              placeholder="localhost"
              style={inputStyle}
            />
          </label>

          {/* Port */}
          <label style={labelStyle}>
            <span>Port</span>
            <input
              type="number"
              value={form.port ?? DEFAULT_PORTS[form.type]}
              onChange={(e) => handleField('port', parseInt(e.target.value, 10))}
              style={{ ...inputStyle, width: 100 }}
            />
          </label>

          {/* Username (not redis) */}
          {!isRedisType && (
            <label style={labelStyle}>
              <span>Username</span>
              <input
                type="text"
                value={form.username ?? ''}
                onChange={(e) => handleField('username', e.target.value)}
                placeholder="root"
                style={inputStyle}
              />
            </label>
          )}

          {/* Password */}
          <label style={labelStyle}>
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(e) => handleField('password', e.target.value)}
              placeholder={editId ? '(unchanged)' : ''}
              style={inputStyle}
            />
          </label>

          {/* Database (not redis) */}
          {!isRedisType && (
            <label style={labelStyle}>
              <span>Database</span>
              <input
                type="text"
                value={form.database ?? ''}
                onChange={(e) => handleField('database', e.target.value)}
                placeholder="mydb"
                style={inputStyle}
              />
            </label>
          )}
        </>
      )}

      {/* Group */}
      <label style={labelStyle}>
        <span>Group</span>
        <input
          type="text"
          value={form.group ?? ''}
          onChange={(e) => handleField('group', e.target.value)}
          placeholder="(optional)"
          style={inputStyle}
        />
      </label>

      {/* Color */}
      <label style={labelStyle}>
        <span>Color</span>
        <input
          type="color"
          value={form.color || '#4fc3f7'}
          onChange={(e) => handleField('color', e.target.value)}
          style={{ width: 40, height: 28, padding: 2, border: 'none', background: 'none', cursor: 'pointer' }}
        />
      </label>

      {/* Test result */}
      {testStatus === 'ok' && (
        <div style={{ color: 'var(--vscode-testing-iconPassed, #4caf50)', fontSize: 13 }}>
          Connection successful
        </div>
      )}
      {testStatus === 'fail' && (
        <div style={{ color: 'var(--vscode-errorForeground, #f44)', fontSize: 13 }}>
          {testError}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={handleSave} disabled={!form.name.trim()}>
          {editId ? 'Update' : 'Save'}
        </button>
        <button
          className="secondary"
          onClick={handleTest}
          disabled={testStatus === 'testing'}
        >
          {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
        </button>
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
};
