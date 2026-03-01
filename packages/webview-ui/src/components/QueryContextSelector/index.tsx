import React, { useCallback, useEffect } from 'react';
import type { DatabaseType } from '@dbmanager/shared';
import { useConnectionStore } from '../../stores/connection';
import { useQueryStore } from '../../stores/query';
import { postMessage } from '../../vscode-api';

interface QueryContextSelectorProps {
  connectionId: string;
  onConnectionChange: (connectionId: string) => void;
}

const DB_TYPE_COLORS: Record<DatabaseType, string> = {
  mysql: '#00758F',
  mariadb: '#6B3FA0',
  postgresql: '#336791',
  sqlite: '#ff9800',
  redis: '#DC382D',
};

const DB_TYPE_LABELS: Record<DatabaseType, string> = {
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgresql: 'PostgreSQL',
  sqlite: 'SQLite',
  redis: 'Redis',
};

export function QueryContextSelector({ connectionId, onConnectionChange }: QueryContextSelectorProps) {
  const connections = useConnectionStore((s) => s.connections);
  const { databases, schemas, database, schema, setDatabase, setSchema } = useQueryStore();

  const connection = connections.find((c) => c.id === connectionId);
  const dbType = connection?.type;

  // SQL connections only (exclude Redis)
  const sqlConnections = connections.filter((c) => c.type !== 'redis');

  // Fetch databases when connection changes
  useEffect(() => {
    if (connectionId) {
      postMessage({ type: 'getDatabases', connectionId });
    }
  }, [connectionId]);

  // Fetch schemas when database changes (PostgreSQL)
  useEffect(() => {
    if (connectionId && database && dbType === 'postgresql') {
      postMessage({ type: 'getSchemas', connectionId, database });
    }
  }, [connectionId, database, dbType]);

  const handleConnectionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newId = e.target.value;
      if (newId && newId !== connectionId) {
        setDatabase(undefined);
        setSchema(undefined);
        onConnectionChange(newId);
      }
    },
    [connectionId, onConnectionChange, setDatabase, setSchema],
  );

  const handleDatabaseChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newDb = e.target.value || undefined;
      setDatabase(newDb);
      setSchema(undefined);
      if (newDb) {
        postMessage({ type: 'switchQueryContext', connectionId, database: newDb });
      }
    },
    [connectionId, setDatabase, setSchema],
  );

  const handleSchemaChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newSchema = e.target.value || undefined;
      setSchema(newSchema);
      if (newSchema) {
        postMessage({ type: 'switchQueryContext', connectionId, database, schema: newSchema });
      }
    },
    [connectionId, database, setSchema],
  );

  const selectStyle: React.CSSProperties = {
    fontSize: 12,
    padding: '2px 6px',
    background: 'var(--vscode-dropdown-background, #3c3c3c)',
    color: 'var(--vscode-dropdown-foreground, #cccccc)',
    border: '1px solid var(--vscode-dropdown-border, #3c3c3c)',
    borderRadius: 3,
    outline: 'none',
    maxWidth: 180,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: 'var(--vscode-descriptionForeground, #808080)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: 600,
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 44,
        padding: '4px 16px',
        borderBottom: '1px solid var(--vscode-panel-border, #333)',
        flexShrink: 0,
        gap: 16,
        background: 'var(--vscode-editorGroupHeader-tabsBackground)',
        overflow: 'hidden',
      }}
    >
      {/* DB Type Badge */}
      {dbType && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '3px 8px',
            borderRadius: 3,
            fontSize: 11,
            fontWeight: 500,
            fontFamily: "'JetBrains Mono', var(--vscode-editor-font-family, monospace)",
            lineHeight: '16px',
            background: DB_TYPE_COLORS[dbType],
            color: '#fff',
            flexShrink: 0,
          }}
        >
          {DB_TYPE_LABELS[dbType]}
        </span>
      )}

      {/* Connection Selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={labelStyle}>Connection</span>
        <select style={selectStyle} value={connectionId} onChange={handleConnectionChange}>
          {!connectionId && <option value="">Select connection...</option>}
          {sqlConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Database Selector */}
      {databases.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={labelStyle}>Database</span>
          <select style={selectStyle} value={database ?? ''} onChange={handleDatabaseChange}>
            <option value="">—</option>
            {databases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Schema Selector (PostgreSQL only) */}
      {dbType === 'postgresql' && schemas.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={labelStyle}>Schema</span>
          <select style={selectStyle} value={schema ?? ''} onChange={handleSchemaChange}>
            <option value="">—</option>
            {schemas.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
