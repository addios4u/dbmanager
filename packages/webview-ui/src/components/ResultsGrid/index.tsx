import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useResultsStore } from '../../stores/results';
import { useQueryStore } from '../../stores/query';
import { postMessage } from '../../vscode-api';
import { toCSV, toJSON, toXML } from '../../utils/export';

type ExportFormat = 'csv' | 'json' | 'xml';

export function ResultsGrid() {
  const { columns, rows, totalRows, executionTime, error } = useResultsStore();
  const { isExecuting } = useQueryStore();
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isDark =
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast');

  // Listen for export feedback
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'exportComplete') {
        setExportStatus({ type: 'success', text: `Exported: ${msg.filePath as string}` });
        setTimeout(() => setExportStatus(null), 5000);
      } else if (msg?.type === 'exportError') {
        setExportStatus({ type: 'error', text: `Export failed: ${msg.error as string}` });
        setTimeout(() => setExportStatus(null), 5000);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const close = () => setShowExportMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showExportMenu]);

  const handleExport = useCallback(
    (format: ExportFormat) => {
      let content: string;
      switch (format) {
        case 'csv':
          content = toCSV(columns, rows);
          break;
        case 'json':
          content = toJSON(rows);
          break;
        case 'xml':
          content = toXML(columns, rows);
          break;
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      postMessage({
        type: 'exportQueryResults',
        format,
        content,
        defaultFileName: `query-results-${timestamp}`,
      });
      setShowExportMenu(false);
    },
    [columns, rows],
  );

  const colDefs = useMemo<ColDef[]>(
    () =>
      columns.map((col) => ({
        field: col.name,
        headerName: col.name,
        sortable: true,
        filter: true,
        resizable: true,
        minWidth: 80,
        tooltipValueGetter: (params) =>
          params.value !== null && params.value !== undefined
            ? String(params.value)
            : '(null)',
        cellStyle: (params) => {
          if (params.value === null || params.value === undefined) {
            return { color: 'var(--vscode-disabledForeground, #888)', fontStyle: 'italic' };
          }
          return null;
        },
        valueFormatter: (params) => {
          if (params.value === null || params.value === undefined) return '(null)';
          if (typeof params.value === 'object') return JSON.stringify(params.value);
          return String(params.value);
        },
      })),
    [columns],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      filter: true,
      resizable: true,
      unSortIcon: true,
    }),
    [],
  );

  if (isExecuting) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--vscode-foreground)',
          opacity: 0.7,
        }}
      >
        Executing query...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: 16,
          color: 'var(--vscode-errorForeground, #f44)',
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
          fontSize: 13,
          whiteSpace: 'pre-wrap',
        }}
      >
        <strong>Error:</strong> {error}
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--vscode-foreground)',
          opacity: 0.5,
        }}
      >
        Run a query to see results
      </div>
    );
  }

  const menuItemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '4px 12px',
    fontSize: 12,
    textAlign: 'left' as const,
    background: 'none',
    border: 'none',
    color: 'var(--vscode-foreground)',
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 10px',
          fontSize: 11,
          opacity: 0.7,
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          background: 'var(--vscode-editorGroupHeader-tabsBackground)',
        }}
      >
        <span>{totalRows.toLocaleString()} rows &middot; {executionTime}ms</span>

        {exportStatus && (
          <span
            style={{
              marginLeft: 12,
              fontSize: 11,
              color: exportStatus.type === 'success'
                ? 'var(--vscode-testing-iconPassed, #73c991)'
                : 'var(--vscode-errorForeground, #f44)',
            }}
          >
            {exportStatus.text}
          </span>
        )}

        <span style={{ flex: 1 }} />

        <div style={{ position: 'relative' }}>
          <button
            className="secondary"
            style={{ fontSize: 11, padding: '1px 8px', cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              setShowExportMenu(!showExportMenu);
            }}
          >
            Export &#x25BE;
          </button>
          {showExportMenu && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: 2,
                minWidth: 100,
                background: 'var(--vscode-menu-background, var(--vscode-editorWidget-background, #252526))',
                border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border, #454545))',
                borderRadius: 3,
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                zIndex: 1000,
                padding: '4px 0',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {(['csv', 'json', 'xml'] as ExportFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  style={menuItemStyle}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.background = 'var(--vscode-list-hoverBackground, #2a2d2e)';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.background = 'none';
                  }}
                  onClick={() => handleExport(fmt)}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div
        className={isDark ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}
        style={{ flex: 1, minHeight: 0 }}
      >
        <AgGridReact
          rowData={rows}
          columnDefs={colDefs}
          defaultColDef={defaultColDef}
          pagination={true}
          paginationPageSize={100}
          tooltipShowDelay={300}
          enableCellTextSelection={true}
          ensureDomOrder={true}
        />
      </div>
    </div>
  );
}
