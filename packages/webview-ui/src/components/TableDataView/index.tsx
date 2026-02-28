import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, SortChangedEvent } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { PAGE_SIZE } from '@dbmanager/shared/src/constants';
import { postMessage } from '../../vscode-api';
import { useTableDataStore } from '../../stores/tableData';
import { ContextHeader } from '../ContextHeader';
import { Pagination } from '../Pagination';
import { StatusBar } from '../StatusBar';

interface TableDataViewProps {
  connectionId: string;
  table: string;
  schema?: string;
  database?: string;
}

export function TableDataView({ connectionId, table, schema, database }: TableDataViewProps) {
  const { columns, rows, totalRows, offset, isLoading } = useTableDataStore();
  const [whereClause, setWhereClause] = useState('');
  const [appliedWhere, setAppliedWhere] = useState('');
  const sortRef = useRef<{ col?: string; dir?: 'asc' | 'desc' }>({});

  const isDark =
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast');

  const fetchData = useCallback(
    (opts?: { offset?: number; sortColumn?: string; sortDirection?: 'asc' | 'desc'; where?: string | null }) => {
      // where: null = explicitly clear, undefined = use current appliedWhere
      const w = opts?.where !== undefined ? (opts.where || undefined) : (appliedWhere || undefined);
      postMessage({
        type: 'getTableData',
        connectionId,
        table,
        schema,
        offset: opts?.offset ?? 0,
        limit: PAGE_SIZE,
        sortColumn: opts?.sortColumn ?? sortRef.current.col,
        sortDirection: opts?.sortDirection ?? sortRef.current.dir,
        where: w,
      });
    },
    [connectionId, table, schema, appliedWhere],
  );

  useEffect(() => {
    fetchData();
  }, [connectionId, table, schema]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApplyWhere = useCallback(() => {
    setAppliedWhere(whereClause);
    fetchData({ offset: 0, where: whereClause });
  }, [whereClause, fetchData]);

  const handleClearWhere = useCallback(() => {
    setWhereClause('');
    setAppliedWhere('');
    fetchData({ offset: 0, where: null });
  }, [fetchData]);

  const colDefs = useMemo<ColDef[]>(
    () =>
      columns.map((col) => ({
        field: col.name,
        headerName: col.name,
        headerTooltip: `${col.type}${col.nullable ? ' (nullable)' : ' (not null)'}`,
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

  const handlePageChange = useCallback(
    (newOffset: number) => {
      fetchData({ offset: newOffset });
    },
    [fetchData],
  );

  const handleSortChanged = useCallback(
    (event: SortChangedEvent) => {
      const colStates = event.api.getColumnState();
      const sortedCol = colStates.find((s) => s.sort != null);
      sortRef.current = {
        col: sortedCol?.colId,
        dir: sortedCol?.sort ?? undefined,
      };
      fetchData({
        offset,
        sortColumn: sortedCol?.colId,
        sortDirection: sortedCol?.sort ?? undefined,
      });
    },
    [offset, fetchData],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ContextHeader
        connectionId={connectionId}
        database={database}
        schema={schema}
        table={table}
        extraInfo={totalRows > 0 ? `${totalRows.toLocaleString()} rows` : undefined}
      />
      {/* WHERE filter bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 12px',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          flexShrink: 0,
          fontSize: 12,
        }}
      >
        <span style={{ opacity: 0.6, flexShrink: 0, fontWeight: 600 }}>WHERE</span>
        <input
          type="text"
          value={whereClause}
          onChange={(e) => setWhereClause(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleApplyWhere()}
          placeholder="e.g. status = 'active' AND age > 20"
          style={{
            flex: 1,
            minWidth: 100,
            fontSize: 12,
            padding: '2px 6px',
            fontFamily: 'var(--vscode-editor-font-family, monospace)',
          }}
        />
        <button
          onClick={handleApplyWhere}
          style={{ fontSize: 11, padding: '2px 8px' }}
        >
          Apply
        </button>
        {appliedWhere && (
          <button
            className="secondary"
            onClick={handleClearWhere}
            style={{ fontSize: 11, padding: '2px 8px' }}
          >
            Clear
          </button>
        )}
      </div>
      <div
        className={isDark ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}
        style={{ flex: 1, minHeight: 0 }}
      >
        <AgGridReact
          rowData={rows}
          columnDefs={colDefs}
          defaultColDef={defaultColDef}
          tooltipShowDelay={300}
          enableCellTextSelection={true}
          ensureDomOrder={true}
          onSortChanged={handleSortChanged}
        />
      </div>
      <Pagination
        totalRows={totalRows}
        offset={offset}
        pageSize={PAGE_SIZE}
        onPageChange={handlePageChange}
        isLoading={isLoading}
      />
      <StatusBar rowCount={rows.length} />
    </div>
  );
}
