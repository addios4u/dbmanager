import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, SortChangedEvent, CellDoubleClickedEvent } from 'ag-grid-community';
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

interface CellEditInfo {
  columnName: string;
  columnType: string;
  nullable: boolean;
  currentValue: unknown;
  rowData: Record<string, unknown>;
}

function isBooleanType(columnType: string): boolean {
  const t = columnType.toLowerCase();
  return t === 'boolean' || t === 'bool' || t === 'tinyint(1)' || t === 'bit(1)';
}

export function TableDataView({ connectionId, table, schema, database }: TableDataViewProps) {
  const { columns, rows, totalRows, offset, primaryKeys, isLoading } = useTableDataStore();
  const [whereClause, setWhereClause] = useState('');
  const [appliedWhere, setAppliedWhere] = useState('');
  const [statusError, setStatusError] = useState<string | undefined>(undefined);
  const [editingCell, setEditingCell] = useState<CellEditInfo | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const sortRef = useRef<{ col?: string; dir?: 'asc' | 'desc' }>({});

  const isDark =
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast');

  const canEdit = primaryKeys.length > 0;

  const fetchData = useCallback(
    (opts?: { offset?: number; sortColumn?: string; sortDirection?: 'asc' | 'desc'; where?: string | null }) => {
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

  // Listen for editResult messages
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'editResult') {
        setIsSaving(false);
        if (msg.success) {
          setEditingCell(null);
          setStatusError(undefined);
          fetchData({ offset });
        } else {
          setStatusError(msg.error ?? 'Save failed.');
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [offset, fetchData]);

  const handleApplyWhere = useCallback(() => {
    setAppliedWhere(whereClause);
    fetchData({ offset: 0, where: whereClause });
  }, [whereClause, fetchData]);

  const handleClearWhere = useCallback(() => {
    setWhereClause('');
    setAppliedWhere('');
    fetchData({ offset: 0, where: null });
  }, [fetchData]);

  const handleCellDoubleClicked = useCallback(
    (event: CellDoubleClickedEvent) => {
      if (!canEdit) return;
      const field = event.colDef.field;
      if (!field) return;
      // Don't allow editing PK columns
      if (primaryKeys.includes(field)) return;
      const col = columns.find((c) => c.name === field);
      if (!col) return;
      const currentValue = (event.data as Record<string, unknown>)[field];
      setEditingCell({
        columnName: field,
        columnType: col.type,
        nullable: col.nullable,
        currentValue,
        rowData: event.data as Record<string, unknown>,
      });
      setEditValue(
        currentValue === null || currentValue === undefined
          ? ''
          : isBooleanType(col.type)
            ? (currentValue ? 'true' : 'false')
            : typeof currentValue === 'object'
              ? JSON.stringify(currentValue)
              : String(currentValue),
      );
      setStatusError(undefined);
    },
    [canEdit, primaryKeys, columns],
  );

  const handleSaveCell = useCallback(() => {
    if (!editingCell) return;
    const pk: Record<string, unknown> = {};
    for (const k of primaryKeys) {
      pk[k] = editingCell.rowData[k];
    }
    // Determine the new value
    let newValue: unknown;
    if (editingCell.nullable && editValue === '') {
      newValue = null;
    } else if (isBooleanType(editingCell.columnType)) {
      newValue = editValue === 'true';
    } else {
      newValue = editValue;
    }
    setIsSaving(true);
    postMessage({
      type: 'saveTableEdits',
      connectionId,
      edits: [{
        type: 'update',
        table,
        primaryKey: pk,
        changes: { [editingCell.columnName]: newValue },
      }],
    });
  }, [editingCell, editValue, primaryKeys, connectionId, table]);

  const handleSetNull = useCallback(() => {
    if (!editingCell) return;
    const pk: Record<string, unknown> = {};
    for (const k of primaryKeys) {
      pk[k] = editingCell.rowData[k];
    }
    setIsSaving(true);
    postMessage({
      type: 'saveTableEdits',
      connectionId,
      edits: [{
        type: 'update',
        table,
        primaryKey: pk,
        changes: { [editingCell.columnName]: null },
      }],
    });
  }, [editingCell, primaryKeys, connectionId, table]);

  const colDefs = useMemo<ColDef[]>(
    () =>
      columns.map((col) => {
        const isPk = primaryKeys.includes(col.name);
        return {
          field: col.name,
          headerName: col.name,
          headerTooltip: `${col.type}${col.nullable ? ' (nullable)' : ' (not null)'}${isPk ? ' [PK]' : ''}`,
          sortable: true,
          filter: true,
          resizable: true,
          minWidth: 80,
          tooltipValueGetter: (params) =>
            params.value !== null && params.value !== undefined
              ? String(params.value)
              : '(null)',
          cellStyle: (params): Record<string, string> | null => {
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
        };
      }),
    [columns, primaryKeys],
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
          onCellDoubleClicked={canEdit ? handleCellDoubleClicked : undefined}
        />
      </div>
      <Pagination
        totalRows={totalRows}
        offset={offset}
        pageSize={PAGE_SIZE}
        onPageChange={handlePageChange}
        isLoading={isLoading}
      />
      <StatusBar rowCount={rows.length} error={statusError} />

      {/* Cell edit popup */}
      {editingCell && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)',
            zIndex: 9999,
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !isSaving) setEditingCell(null); }}
        >
          <div
            style={{
              background: 'var(--vscode-editor-background, #1e1e1e)',
              border: '1px solid var(--vscode-panel-border, #333)',
              borderRadius: 6,
              padding: 16,
              minWidth: 360,
              maxWidth: '80vw',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>Edit Cell</span>
              <span style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 3,
                background: 'var(--vscode-badge-background)',
                color: 'var(--vscode-badge-foreground)',
              }}>
                {editingCell.columnType}
              </span>
              {editingCell.nullable && (
                <span style={{ fontSize: 10, opacity: 0.6 }}>nullable</span>
              )}
            </div>
            <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.7 }}>
              <strong>{editingCell.columnName}</strong>
              {' = '}
              <span style={{
                fontFamily: 'var(--vscode-editor-font-family, monospace)',
                opacity: editingCell.currentValue === null ? 0.5 : 1,
                fontStyle: editingCell.currentValue === null ? 'italic' : 'normal',
              }}>
                {editingCell.currentValue === null || editingCell.currentValue === undefined
                  ? 'NULL'
                  : typeof editingCell.currentValue === 'object'
                    ? JSON.stringify(editingCell.currentValue)
                    : String(editingCell.currentValue)}
              </span>
            </div>
            {isBooleanType(editingCell.columnType) ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setEditValue('true')}
                  style={{
                    flex: 1,
                    fontSize: 13,
                    padding: '6px 8px',
                    fontWeight: editValue === 'true' ? 700 : 400,
                    background: editValue === 'true' ? 'var(--vscode-button-background, #0e639c)' : 'transparent',
                    color: editValue === 'true' ? 'var(--vscode-button-foreground, #fff)' : 'var(--vscode-foreground)',
                    border: '1px solid var(--vscode-panel-border, #333)',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  TRUE
                </button>
                <button
                  onClick={() => setEditValue('false')}
                  style={{
                    flex: 1,
                    fontSize: 13,
                    padding: '6px 8px',
                    fontWeight: editValue === 'false' ? 700 : 400,
                    background: editValue === 'false' ? 'var(--vscode-button-background, #0e639c)' : 'transparent',
                    color: editValue === 'false' ? 'var(--vscode-button-foreground, #fff)' : 'var(--vscode-foreground)',
                    border: '1px solid var(--vscode-panel-border, #333)',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  FALSE
                </button>
              </div>
            ) : (
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveCell(); }
                  if (e.key === 'Escape') setEditingCell(null);
                }}
                placeholder={editingCell.nullable ? 'Empty = NULL' : 'Enter value...'}
                rows={3}
                autoFocus
                style={{
                  width: '100%',
                  fontSize: 13,
                  padding: '6px 8px',
                  fontFamily: 'var(--vscode-editor-font-family, monospace)',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            )}
            {statusError && (
              <div style={{ fontSize: 11, color: 'var(--vscode-errorForeground, #f44)', marginTop: 6 }}>
                {statusError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              {editingCell.nullable && (
                <button
                  className="secondary"
                  onClick={handleSetNull}
                  disabled={isSaving}
                  style={{ fontSize: 11, padding: '3px 10px', marginRight: 'auto' }}
                >
                  Set NULL
                </button>
              )}
              <button
                className="secondary"
                onClick={() => setEditingCell(null)}
                disabled={isSaving}
                style={{ fontSize: 11, padding: '3px 10px' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCell}
                disabled={isSaving}
                style={{ fontSize: 11, padding: '3px 10px' }}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
