import React, { useEffect, useState } from 'react';
import type { PanelMeta, ViewState } from '@dbmanager/shared';
import { postMessage } from './vscode-api';
import { useConnectionStore } from './stores/connection';
import { useResultsStore } from './stores/results';
import { useQueryStore } from './stores/query';
import { useExtensionMessages } from './hooks/useExtensionMessages';
import { QueryEditor } from './components/QueryEditor';
import { ResultsGrid } from './components/ResultsGrid';
import { ConnectionDialog } from './components/ConnectionDialog';
import { WelcomeView } from './components/WelcomeView';
import { TableDataView } from './components/TableDataView';
import { DDLView } from './components/DDLView';
import { ExportDialog } from './components/ExportDialog';
import { RedisBrowser } from './components/RedisBrowser';
import { SplitPane } from './components/SplitPane';
import { ContextHeader } from './components/ContextHeader';
import { QueryContextSelector } from './components/QueryContextSelector';

interface InitialState {
  meta?: PanelMeta;
}

function getInitialViewState(): ViewState {
  const state = (window as unknown as { __INITIAL_STATE__?: InitialState }).__INITIAL_STATE__;
  const meta = state?.meta;
  if (!meta) return { view: 'welcome' };

  switch (meta.kind) {
    case 'connectionDialog':
      return { view: 'connectionDialog', editId: meta.editId };
    case 'query': {
      // Pre-fill SQL editor if initial SQL is provided (e.g. from .sql file)
      if (meta.initialSql) {
        useQueryStore.getState().setSql(meta.initialSql);
      }
      // Pre-set database/schema context (e.g. from tree node or last-used)
      if (meta.database) {
        useQueryStore.getState().setDatabase(meta.database);
      }
      if (meta.schema) {
        useQueryStore.getState().setSchema(meta.schema);
      }
      return { view: 'query', connectionId: meta.connectionId };
    }
    case 'tableData':
      return meta.connectionId && meta.tableName
        ? { view: 'tableData', connectionId: meta.connectionId, table: meta.tableName, schema: meta.schema, database: meta.database }
        : { view: 'welcome' };
    case 'tableEditor':
      // Legacy: tableEditor now handled by unified TableDataView
      return meta.connectionId && meta.tableName
        ? { view: 'tableData', connectionId: meta.connectionId, table: meta.tableName, schema: meta.schema, database: meta.database }
        : { view: 'welcome' };
    case 'ddl':
      return meta.connectionId && meta.tableName
        ? { view: 'ddl', connectionId: meta.connectionId, table: meta.tableName, schema: meta.schema }
        : { view: 'welcome' };
    case 'export':
      return meta.connectionId && meta.tableName
        ? { view: 'export', connectionId: meta.connectionId, table: meta.tableName, schema: meta.schema }
        : { view: 'welcome' };
    case 'redis':
      return meta.connectionId
        ? { view: 'redis', connectionId: meta.connectionId, db: meta.redisDb }
        : { view: 'welcome' };
    default:
      return { view: 'welcome' };
  }
}

export default function App() {
  const [viewState, setViewState] = useState<ViewState>(getInitialViewState);
  const { connections, setActiveConnection } = useConnectionStore();
  const { clear } = useResultsStore();

  // Central message dispatcher — routes to all Zustand stores
  useExtensionMessages();

  // Notify extension that webview is ready
  useEffect(() => {
    postMessage({ type: 'ready' });
  }, []);

  const handleNewConnection = () => {
    setViewState({ view: 'connectionDialog' });
  };

  const handleConnectionSaved = () => {
    setViewState({ view: 'welcome' });
  };

  // Only show the top toolbar for query/welcome/connectionDialog panels
  const isQueryPanel = viewState.view === 'query' || viewState.view === 'welcome' || viewState.view === 'connectionDialog';

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {isQueryPanel && (
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
          {viewState.view !== 'query' && (
            <>
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
                  value=""
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
            </>
          )}
        </div>
      )}

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
            schema={viewState.schema}
            database={viewState.database}
          />
        )}

        {viewState.view === 'ddl' && (
          <DDLView
            connectionId={viewState.connectionId}
            table={viewState.table}
            schema={viewState.schema}
          />
        )}

        {viewState.view === 'export' && (
          <ExportDialog
            connectionId={viewState.connectionId}
            table={viewState.table}
            schema={viewState.schema}
          />
        )}

        {viewState.view === 'redis' && (
          <RedisBrowser
            connectionId={viewState.connectionId}
            db={viewState.db}
          />
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

// ---- Query sub-view (kept inline — composes existing components with SplitPane) ----

function QueryView({ connectionId: initialConnectionId }: { connectionId?: string }) {
  const [activeConnectionId, setActiveConnectionId] = useState(initialConnectionId ?? '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <QueryContextSelector
        connectionId={activeConnectionId}
        onConnectionChange={setActiveConnectionId}
      />
      <SplitPane initialRatio={0.4} minTopHeight={120} minBottomHeight={100}>
        <QueryEditor connectionId={activeConnectionId} />
        <ResultsGrid />
      </SplitPane>
    </div>
  );
}
