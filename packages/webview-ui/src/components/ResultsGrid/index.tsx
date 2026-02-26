import React, { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useResultsStore } from '../../stores/results';
import { useQueryStore } from '../../stores/query';

export function ResultsGrid() {
  const { columns, rows, totalRows, executionTime, error } = useResultsStore();
  const { isExecuting } = useQueryStore();

  const isDark =
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast');

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: '4px 10px',
          fontSize: 11,
          opacity: 0.7,
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          background: 'var(--vscode-editorGroupHeader-tabsBackground)',
        }}
      >
        {totalRows.toLocaleString()} rows &middot; {executionTime}ms
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
