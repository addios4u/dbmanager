import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, CellValueChangedEvent, RowClassParams } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { PAGE_SIZE } from '@dbmanager/shared/src/constants';
import { postMessage } from '../../vscode-api';
import { useTableDataStore } from '../../stores/tableData';
import { useTableEditorStore } from '../../stores/tableEditor';
import { ContextHeader } from '../ContextHeader';
import { Pagination } from '../Pagination';
import { StatusBar } from '../StatusBar';

interface TableEditorViewProps {
  connectionId: string;
  table: string;
  schema?: string;
  database?: string;
}

export function TableEditorView({ connectionId, table, schema, database }: TableEditorViewProps) {
  const { columns, rows, totalRows, offset, primaryKeys, isLoading } = useTableDataStore();
  const {
    hasChanges,
    changeCount,
    trackUpdate,
    trackDelete,
    trackInsert,
    discardChanges,
    getEdits,
    isRowDeleted,
    isCellDirty,
    clear: clearEdits,
  } = useTableEditorStore();

  const [statusError, setStatusError] = useState<string | undefined>(undefined);
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined);

  const isDark =
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast');

  useEffect(() => {
    postMessage({ type: 'getTableData', connectionId, table, schema, offset: 0, limit: PAGE_SIZE });
  }, [connectionId, table, schema]);

  // Listen for editResult messages
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'editResult') {
        if (msg.success) {
          discardChanges();
          setStatusError(undefined);
          setStatusMessage('Changes saved successfully.');
          postMessage({ type: 'getTableData', connectionId, table, schema, offset, limit: PAGE_SIZE });
        } else {
          setStatusError(msg.error ?? 'Save failed.');
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [connectionId, table, schema, offset, discardChanges]);

  const colDefs = useMemo<ColDef[]>(() => {
    if (columns.length === 0) return [];
    return columns.map((col) => {
      const isPk = primaryKeys.includes(col.name);
      return {
        field: col.name,
        headerName: col.name,
        headerTooltip: `${col.type}${col.nullable ? ' (nullable)' : ' (not null)'}${isPk ? ' [PK]' : ''}`,
        sortable: true,
        filter: true,
        resizable: true,
        minWidth: 80,
        editable: !isPk,
        tooltipValueGetter: (params) =>
          params.value !== null && params.value !== undefined
            ? String(params.value)
            : '(null)',
        cellStyle: (params) => {
          const rowData = params.data as Record<string, unknown>;
          if (isRowDeleted(primaryKeys, rowData)) {
            return {
              textDecoration: 'line-through' as const,
              background: 'var(--vscode-diffEditor-removedTextBackground, rgba(255,0,0,0.1))',
              color: 'var(--vscode-disabledForeground, #888)',
              fontStyle: 'normal' as const,
            };
          }
          if (isCellDirty(primaryKeys, rowData, col.name)) {
            return {
              background: 'var(--vscode-diffEditor-insertedTextBackground, rgba(155,185,85,0.2))',
              color: '' as string,
              fontStyle: 'normal' as const,
              textDecoration: 'none' as const,
            };
          }
          if (params.value === null || params.value === undefined) {
            return {
              color: 'var(--vscode-disabledForeground, #888)',
              fontStyle: 'italic' as const,
              background: '' as string,
              textDecoration: 'none' as const,
            };
          }
          return null;
        },
        valueFormatter: (params) => {
          if (params.value === null || params.value === undefined) return '(null)';
          if (typeof params.value === 'object') return JSON.stringify(params.value);
          return String(params.value);
        },
      };
    });
  }, [columns, primaryKeys, isRowDeleted, isCellDirty]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      filter: true,
      resizable: true,
      unSortIcon: true,
    }),
    [],
  );

  const getRowClass = useCallback(
    (params: RowClassParams) => {
      const rowData = params.data as Record<string, unknown>;
      if (isRowDeleted(primaryKeys, rowData)) return 'row-deleted';
      return undefined;
    },
    [primaryKeys, isRowDeleted],
  );

  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      const field = event.colDef.field;
      if (!field) return;
      trackUpdate(primaryKeys, event.data as Record<string, unknown>, field, event.newValue, event.oldValue);
    },
    [primaryKeys, trackUpdate],
  );

  const handleAddRow = useCallback(() => {
    const emptyRow: Record<string, unknown> = {};
    columns.forEach((col) => {
      emptyRow[col.name] = null;
    });
    trackInsert(emptyRow);
  }, [columns, trackInsert]);

  const handleDeleteSelected = useCallback(() => {
    // Delete action handled via context or keyboard; here just a placeholder
    // In a real implementation, we'd get selected rows from agGridRef
  }, []);

  const handleCommit = useCallback(() => {
    const edits = getEdits(table);
    postMessage({ type: 'saveTableEdits', connectionId, edits });
    setStatusError(undefined);
    setStatusMessage(undefined);
  }, [connectionId, table, getEdits]);

  const handleDiscard = useCallback(() => {
    discardChanges();
    setStatusError(undefined);
    setStatusMessage(undefined);
  }, [discardChanges]);

  const handlePageChange = useCallback(
    (newOffset: number) => {
      postMessage({
        type: 'getTableData',
        connectionId,
        table,
        schema,
        offset: newOffset,
        limit: PAGE_SIZE,
      });
    },
    [connectionId, table, schema],
  );

  if (primaryKeys.length === 0 && columns.length > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <ContextHeader
          connectionId={connectionId}
          database={database}
          schema={schema}
          table={table}
          badge="Editing"
        />
        <div
          style={{
            padding: 16,
            color: 'var(--vscode-editorWarning-foreground, #cca700)',
            fontSize: 13,
          }}
        >
          This table has no primary key. Editing requires a primary key.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ContextHeader
        connectionId={connectionId}
        database={database}
        schema={schema}
        table={table}
        badge="Editing"
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: '4px 12px',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          background: 'var(--vscode-editorGroupHeader-tabsBackground)',
        }}
      >
        <button onClick={handleAddRow} title="Add a new empty row">
          + Add Row
        </button>
        <button
          onClick={handleCommit}
          disabled={!hasChanges}
          style={{ opacity: !hasChanges ? 0.5 : 1 }}
          title="Save all pending changes"
        >
          Commit Changes{changeCount > 0 ? ` (${changeCount})` : ''}
        </button>
        <button
          className="secondary"
          onClick={handleDiscard}
          disabled={!hasChanges}
          style={{ opacity: !hasChanges ? 0.5 : 1 }}
          title="Discard all pending changes"
        >
          Discard
        </button>
        {changeCount > 0 && (
          <span
            style={{
              fontSize: 11,
              opacity: 0.7,
              color: 'var(--vscode-foreground)',
            }}
          >
            {changeCount} pending change{changeCount !== 1 ? 's' : ''}
          </span>
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
          rowSelection="multiple"
          getRowClass={getRowClass}
          onCellValueChanged={handleCellValueChanged}
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
    </div>
  );
}
