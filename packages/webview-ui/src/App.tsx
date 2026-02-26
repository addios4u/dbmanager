import React, { useEffect, useState } from 'react';
import type { ExtensionMessage, ViewState } from '@dbmanager/shared';
import { postMessage } from './vscode-api';
import { useConnectionStore } from './stores/connection';
import { useResultsStore } from './stores/results';
import { useQueryStore } from './stores/query';
import { useSchemaStore } from './stores/schema';
import { QueryEditor } from './components/QueryEditor';
import { ResultsGrid } from './components/ResultsGrid';
import { ConnectionDialog } from './components/ConnectionDialog';

export default function App() {
  const [viewState, setViewState] = useState<ViewState>({ view: 'welcome' });
  const { setConnections, setActiveConnection, connections } = useConnectionStore();
  const { setResults, setError, clear } = useResultsStore();
  const { setExecuting } = useQueryStore();
  const { setDatabases } = useSchemaStore();

  // Handle messages from extension
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtensionMessage;

      switch (msg.type) {
        case 'stateSync':
          setConnections(msg.connections);
          if (msg.activeConnectionId) {
            setActiveConnection(msg.activeConnectionId);
            setViewState({ view: 'query', connectionId: msg.activeConnectionId });
          }
          break;

        case 'queryResult':
          setExecuting(false);
          setResults(msg.columns, msg.rows, msg.totalRows ?? msg.rows.length, msg.executionTime);
          break;

        case 'queryError':
          setExecuting(false);
          setError(msg.error);
          break;

        case 'schemaData':
          setDatabases(msg.databases);
          break;

        case 'tableData':
          setResults(msg.columns, msg.rows, msg.totalRows, 0);
          setViewState({ view: 'tableData', connectionId: msg.connectionId, table: msg.table });
          break;

        case 'connectionTestResult':
          // Handled by ConnectionDialog directly
          break;

        case 'error':
          setError(msg.message);
          break;

        default:
          break;
      }
    };

    window.addEventListener('message', handler);

    // Notify extension that webview is ready
    postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handler);
  }, [setConnections, setActiveConnection, setResults, setError, setExecuting, setDatabases]);

  const handleNewConnection = () => {
    setViewState({ view: 'connectionDialog' });
  };

  const handleConnectionSaved = () => {
    setViewState({ view: 'welcome' });
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          background: 'var(--vscode-titleBar-activeBackground, #1e1e1e)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13 }}>DB Manager</span>
        <span style={{ flex: 1 }} />
        {connections.length > 0 && (
          <select
            style={{ fontSize: 12, padding: '2px 6px' }}
            onChange={(e) => {
              const id = e.target.value;
              if (id) {
                setActiveConnection(id);
                setViewState({ view: 'query', connectionId: id });
                clear();
              }
            }}
            value={
              viewState.view !== 'welcome' && viewState.view !== 'connectionDialog'
                ? viewState.connectionId
                : ''
            }
          >
            <option value="">Select connection...</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type})
              </option>
            ))}
          </select>
        )}
        <button
          className="secondary"
          style={{ fontSize: 12, padding: '2px 10px' }}
          onClick={handleNewConnection}
        >
          + Add Connection
        </button>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {viewState.view === 'welcome' && (
          <WelcomeView onAddConnection={handleNewConnection} />
        )}

        {viewState.view === 'query' && (
          <QueryView connectionId={viewState.connectionId} />
        )}

        {viewState.view === 'tableData' && (
          <TableDataView
            connectionId={viewState.connectionId}
            table={viewState.table}
          />
        )}

        {viewState.view === 'schemaView' && (
          <SchemaView
            connectionId={viewState.connectionId}
            table={viewState.table}
          />
        )}

        {viewState.view === 'redis' && (
          <RedisView connectionId={viewState.connectionId} />
        )}

        {viewState.view === 'connectionDialog' && (
          <ConnectionDialog
            editId={viewState.editId}
            onClose={handleConnectionSaved}
          />
        )}
      </div>
    </div>
  );
}

// ---- Sub-views ----

function WelcomeView({ onAddConnection }: { onAddConnection: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 16,
        opacity: 0.85,
      }}
    >
      <svg width={48} height={48} viewBox="0 0 48 48" fill="none">
        <ellipse cx={24} cy={14} rx={18} ry={6} stroke="currentColor" strokeWidth={2} />
        <path d="M6 14v20c0 3.314 8.059 6 18 6s18-2.686 18-6V14" stroke="currentColor" strokeWidth={2} />
        <path d="M6 24c0 3.314 8.059 6 18 6s18-2.686 18-6" stroke="currentColor" strokeWidth={2} />
      </svg>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>DB Manager</h1>
      <p style={{ fontSize: 13, opacity: 0.7, textAlign: 'center', maxWidth: 320 }}>
        Connect to MySQL, MariaDB, PostgreSQL, SQLite, or Redis databases to get started.
      </p>
      <button onClick={onAddConnection} style={{ fontSize: 13, padding: '8px 20px' }}>
        Add Connection
      </button>
    </div>
  );
}

function QueryView({ connectionId }: { connectionId: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: '0 0 40%', minHeight: 120, borderBottom: '1px solid var(--vscode-panel-border, #333)' }}>
        <QueryEditor connectionId={connectionId} />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResultsGrid />
      </div>
    </div>
  );
}

function TableDataView({ connectionId, table }: { connectionId: string; table: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: '6px 12px',
          fontSize: 13,
          fontWeight: 600,
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          background: 'var(--vscode-editorGroupHeader-tabsBackground)',
          flexShrink: 0,
        }}
      >
        {table}
        <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 8, fontSize: 12 }}>
          {connectionId}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResultsGrid />
      </div>
    </div>
  );
}

function SchemaView({ connectionId, table }: { connectionId: string; table: string }) {
  const { databases } = useSchemaStore();

  const allTables = databases.flatMap((db) => [
    ...(db.tables ?? []),
    ...(db.schemas ?? []).flatMap((s) => s.tables),
  ]);
  const tableInfo = allTables.find((t) => t.name === table);

  return (
    <div
      style={{
        padding: 20,
        overflowY: 'auto',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600 }}>{table}</h2>
      <p style={{ opacity: 0.6, fontSize: 12 }}>Connection: {connectionId}</p>
      {tableInfo ? (
        <pre
          style={{
            background: 'var(--vscode-textCodeBlock-background, #1e1e1e)',
            padding: 12,
            borderRadius: 4,
            fontSize: 12,
            overflowX: 'auto',
          }}
        >
          {JSON.stringify(tableInfo, null, 2)}
        </pre>
      ) : (
        <p style={{ opacity: 0.6, fontSize: 13 }}>
          Schema information not available. Try running a query on this table.
        </p>
      )}
    </div>
  );
}

function RedisView({ connectionId }: { connectionId: string }) {
  const [pattern, setPattern] = useState('*');
  const [keys, setKeys] = useState<Array<{ key: string; type: string; ttl: number }>>([]);
  const [cursor, setCursor] = useState('0');
  const [hasMore, setHasMore] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState<unknown>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtensionMessage;
      if (msg.type === 'redisKeys' && msg.connectionId === connectionId) {
        setKeys((prev) => (msg.cursor === '0' ? msg.keys : [...prev, ...msg.keys]));
        setCursor(msg.cursor);
        setHasMore(msg.hasMore);
      }
      if (msg.type === 'redisValue' && msg.connectionId === connectionId) {
        setKeyValue(msg.value);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [connectionId]);

  const scan = (reset = true) => {
    postMessage({
      type: 'redisScan',
      connectionId,
      pattern,
      cursor: reset ? '0' : cursor,
      count: 100,
    });
    if (reset) setKeys([]);
  };

  const selectKey = (key: string) => {
    setSelectedKey(key);
    setKeyValue(null);
    postMessage({ type: 'redisGet', connectionId, key });
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Key list */}
      <div
        style={{
          width: 260,
          borderRight: '1px solid var(--vscode-panel-border, #333)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: 8,
            borderBottom: '1px solid var(--vscode-panel-border, #333)',
            display: 'flex',
            gap: 6,
          }}
        >
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && scan()}
            placeholder="Pattern (e.g. user:*)"
            style={{ flex: 1, fontSize: 12 }}
          />
          <button style={{ fontSize: 12, padding: '2px 8px' }} onClick={() => scan()}>
            Scan
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {keys.map((k) => (
            <div
              key={k.key}
              onClick={() => selectKey(k.key)}
              style={{
                padding: '5px 10px',
                cursor: 'pointer',
                fontSize: 12,
                background:
                  selectedKey === k.key ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {k.key}
              </span>
              <span style={{ opacity: 0.5, fontSize: 10, marginLeft: 6, flexShrink: 0 }}>
                {k.type}
              </span>
            </div>
          ))}
          {hasMore && (
            <div style={{ padding: 8 }}>
              <button
                className="secondary"
                style={{ width: '100%', fontSize: 12 }}
                onClick={() => scan(false)}
              >
                Load more
              </button>
            </div>
          )}
          {keys.length === 0 && (
            <div style={{ padding: 16, opacity: 0.5, fontSize: 12, textAlign: 'center' }}>
              Click Scan to load keys
            </div>
          )}
        </div>
      </div>

      {/* Value viewer */}
      <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
        {selectedKey ? (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{selectedKey}</h3>
            {keyValue !== null ? (
              <pre
                style={{
                  background: 'var(--vscode-textCodeBlock-background, #1e1e1e)',
                  padding: 12,
                  borderRadius: 4,
                  fontSize: 12,
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {JSON.stringify(keyValue, null, 2)}
              </pre>
            ) : (
              <div style={{ opacity: 0.5, fontSize: 13 }}>Loading value...</div>
            )}
          </>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              opacity: 0.5,
              fontSize: 13,
            }}
          >
            Select a key to view its value
          </div>
        )}
      </div>
    </div>
  );
}
