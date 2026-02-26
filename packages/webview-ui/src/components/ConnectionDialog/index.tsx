import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { DatabaseType, ConnectionConfig, SshConfig } from '@dbmanager/shared';
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

interface FormState extends Omit<ConnectionConfig, 'id'> {
  password: string;
  sshPassword: string;
  sshPassphrase: string;
}

function emptyConfig(): FormState {
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
    sshPassword: '',
    sshPassphrase: '',
  };
}

export function ConnectionDialog({ editId, onClose }: ConnectionDialogProps) {
  const { connections } = useConnectionStore();

  const existing = editId ? connections.find((c) => c.id === editId) : undefined;

  const [form, setForm] = useState<FormState>(
    existing
      ? { ...existing, password: '', sshPassword: '', sshPassphrase: '' }
      : emptyConfig(),
  );
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testError, setTestError] = useState<string>('');
  const [sshTestStatus, setSshTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [sshTestError, setSshTestError] = useState<string>('');
  const formInitialized = useRef(!!existing);

  // Populate form when connections arrive (edit mode: stateSync arrives after mount)
  useEffect(() => {
    if (editId && !formInitialized.current) {
      const found = connections.find((c) => c.id === editId);
      if (found) {
        formInitialized.current = true;
        setForm({ ...found, password: '', sshPassword: '', sshPassphrase: '' });
      }
    }
  }, [editId, connections]);

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

  const sshEnabled = form.ssh?.enabled ?? false;

  const handleSshToggle = useCallback((enabled: boolean) => {
    setForm((prev) => ({
      ...prev,
      ssh: enabled
        ? { enabled: true, host: '', port: 22, username: '', authMethod: 'password' as const }
        : undefined,
    }));
  }, []);

  const handleSshField = useCallback(
    <K extends keyof SshConfig>(key: K, value: SshConfig[K]) => {
      setForm((prev) => ({
        ...prev,
        ssh: prev.ssh ? { ...prev.ssh, [key]: value } : undefined,
      }));
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
    ssl: (!isSqliteType && form.ssl) || undefined,
    group: form.group || undefined,
    color: form.color || undefined,
    ssh: sshEnabled ? form.ssh : undefined,
  });

  const handleTest = useCallback(() => {
    setTestStatus('testing');
    setTestError('');
    postMessage({
      type: 'testConnection',
      config: buildConfig(),
      password: form.password || undefined,
      sshPassword: form.sshPassword || undefined,
      sshPassphrase: form.sshPassphrase || undefined,
    });
  }, [form, editId]);

  const handleSshTest = useCallback(() => {
    setSshTestStatus('testing');
    setSshTestError('');
    postMessage({
      type: 'testSshTunnel',
      config: buildConfig(),
      sshPassword: form.sshPassword || undefined,
      sshPassphrase: form.sshPassphrase || undefined,
    });
  }, [form, editId]);

  const handleSave = useCallback(() => {
    if (!form.name.trim()) return;
    postMessage({
      type: 'saveConnection',
      config: buildConfig(),
      password: form.password || undefined,
      sshPassword: form.sshPassword || undefined,
      sshPassphrase: form.sshPassphrase || undefined,
    });
    onClose();
  }, [form, editId, onClose]);

  // Listen for test result via window message
  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as { type: string; success?: boolean; error?: string; target?: string; path?: string };
      if (msg.type === 'connectionTestResult') {
        if (msg.success) {
          setTestStatus('ok');
        } else {
          setTestStatus('fail');
          setTestError(msg.error || 'Unknown error');
        }
      } else if (msg.type === 'sshTunnelTestResult') {
        if (msg.success) {
          setSshTestStatus('ok');
        } else {
          setSshTestStatus('fail');
          setSshTestError(msg.error || 'Unknown error');
        }
      } else if (msg.type === 'filePicked' && msg.path) {
        if (msg.target === 'sqlite') {
          setForm((prev) => ({ ...prev, filepath: msg.path! }));
        } else if (msg.target === 'sshKey') {
          setForm((prev) => ({
            ...prev,
            ssh: prev.ssh ? { ...prev.ssh, privateKeyPath: msg.path! } : undefined,
          }));
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 24, overflowY: 'auto' }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
        {editId ? 'Edit Connection' : 'New Connection'}
      </h2>

      {/* Two-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: isSqliteType ? '1fr' : '1fr 1fr', gap: 32 }}>

        {/* Left Panel — Connection Settings */}
        <div style={panelStyle}>
          <h3 style={sectionTitleStyle}>Connection</h3>

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

          {isSqliteType ? (
            <label style={labelStyle}>
              <span>File Path *</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="text"
                  value={form.filepath ?? ''}
                  onChange={(e) => handleField('filepath', e.target.value)}
                  placeholder="/path/to/database.db"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => postMessage({ type: 'browseFile', target: 'sqlite' })}
                  style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  Browse...
                </button>
              </div>
            </label>
          ) : (
            <>
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

              <label style={labelStyle}>
                <span>Port</span>
                <input
                  type="number"
                  value={form.port ?? DEFAULT_PORTS[form.type]}
                  onChange={(e) => handleField('port', parseInt(e.target.value, 10))}
                  style={{ ...inputStyle, width: 100 }}
                />
              </label>

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

              <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.ssl ?? false}
                  onChange={(e) => handleField('ssl', e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span>{isRedisType ? 'Use TLS' : 'Use SSL'}</span>
              </label>
            </>
          )}

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

          <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <span>Color</span>
            <input
              type="color"
              value={form.color || '#4fc3f7'}
              onChange={(e) => handleField('color', e.target.value)}
              style={{ width: 40, height: 28, padding: 2, border: 'none', background: 'none', cursor: 'pointer' }}
            />
          </label>
        </div>

        {/* Right Panel — SSH Tunnel */}
        {!isSqliteType && (
          <div style={panelStyle}>
            <h3 style={sectionTitleStyle}>SSH Tunnel</h3>

            <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={sshEnabled}
                onChange={(e) => handleSshToggle(e.target.checked)}
                style={{ width: 'auto' }}
              />
              <span>Enable SSH Tunnel</span>
            </label>

            {sshEnabled && form.ssh && (
              <>
                <label style={labelStyle}>
                  <span>SSH Host *</span>
                  <input
                    type="text"
                    value={form.ssh.host}
                    onChange={(e) => handleSshField('host', e.target.value)}
                    placeholder="bastion.example.com"
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  <span>SSH Port</span>
                  <input
                    type="number"
                    value={form.ssh.port}
                    onChange={(e) => handleSshField('port', parseInt(e.target.value, 10))}
                    style={{ ...inputStyle, width: 100 }}
                  />
                </label>

                <label style={labelStyle}>
                  <span>SSH Username *</span>
                  <input
                    type="text"
                    value={form.ssh.username}
                    onChange={(e) => handleSshField('username', e.target.value)}
                    placeholder="ubuntu"
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  <span>Auth Method</span>
                  <select
                    value={form.ssh.authMethod}
                    onChange={(e) => handleSshField('authMethod', e.target.value as 'password' | 'privateKey')}
                    style={inputStyle}
                  >
                    <option value="password">Password</option>
                    <option value="privateKey">Private Key</option>
                  </select>
                </label>

                {form.ssh.authMethod === 'password' ? (
                  <label style={labelStyle}>
                    <span>SSH Password</span>
                    <input
                      type="password"
                      value={form.sshPassword}
                      onChange={(e) => handleField('sshPassword', e.target.value)}
                      placeholder={editId ? '(unchanged)' : ''}
                      style={inputStyle}
                    />
                  </label>
                ) : (
                  <>
                    <label style={labelStyle}>
                      <span>Private Key Path *</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          type="text"
                          value={form.ssh.privateKeyPath ?? ''}
                          onChange={(e) => handleSshField('privateKeyPath', e.target.value)}
                          placeholder="~/.ssh/id_rsa"
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => postMessage({ type: 'browseFile', target: 'sshKey' })}
                          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                        >
                          Browse...
                        </button>
                      </div>
                    </label>
                    <label style={labelStyle}>
                      <span>Passphrase</span>
                      <input
                        type="password"
                        value={form.sshPassphrase}
                        onChange={(e) => handleField('sshPassphrase', e.target.value)}
                        placeholder="(optional)"
                        style={inputStyle}
                      />
                    </label>
                  </>
                )}
              </>
            )}

            {/* SSH Tunnel Test */}
            <button
              className="secondary"
              onClick={handleSshTest}
              disabled={sshTestStatus === 'testing' || !form.ssh?.host || !form.ssh?.username}
              style={{ marginTop: 4, alignSelf: 'flex-start' }}
            >
              {sshTestStatus === 'testing' ? 'Testing...' : 'Test SSH Tunnel'}
            </button>
            {sshTestStatus === 'ok' && (
              <div style={{
                padding: '6px 10px', borderRadius: 4, fontSize: 12,
                background: 'rgba(75, 175, 80, 0.15)',
                border: '1px solid var(--vscode-testing-iconPassed, #4caf50)',
                color: 'var(--vscode-testing-iconPassed, #4caf50)',
              }}>
                SSH tunnel OK
              </div>
            )}
            {sshTestStatus === 'fail' && (
              <div style={{
                padding: '6px 10px', borderRadius: 4, fontSize: 12, wordBreak: 'break-word',
                background: 'rgba(244, 67, 54, 0.15)',
                border: '1px solid var(--vscode-errorForeground, #f44)',
                color: 'var(--vscode-errorForeground, #f44)',
              }}>
                SSH failed: {sshTestError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Test result */}
      {testStatus === 'ok' && (
        <div style={{
          marginTop: 12,
          padding: '8px 12px',
          borderRadius: 4,
          background: 'rgba(75, 175, 80, 0.15)',
          border: '1px solid var(--vscode-testing-iconPassed, #4caf50)',
          color: 'var(--vscode-testing-iconPassed, #4caf50)',
          fontSize: 13,
        }}>
          Connection successful
        </div>
      )}
      {testStatus === 'fail' && (
        <div style={{
          marginTop: 12,
          padding: '8px 12px',
          borderRadius: 4,
          background: 'rgba(244, 67, 54, 0.15)',
          border: '1px solid var(--vscode-errorForeground, #f44)',
          color: 'var(--vscode-errorForeground, #f44)',
          fontSize: 13,
          wordBreak: 'break-word',
        }}>
          Connection failed: {testError}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
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

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: '16px 20px',
  border: '1px solid var(--vscode-panel-border, #444)',
  borderRadius: 4,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--vscode-descriptionForeground)',
  marginBottom: 4,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
};
