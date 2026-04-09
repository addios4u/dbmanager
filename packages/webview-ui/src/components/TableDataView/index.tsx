import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as l10n from '@vscode/l10n';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, SortChangedEvent, CellDoubleClickedEvent, SelectionChangedEvent } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { PAGE_SIZE } from '@dbmanager/shared/src/constants';
import { postMessage } from '../../vscode-api';
import { useTableDataStore } from '../../stores/tableData';
import { ContextHeader } from '../ContextHeader';
import { Pagination } from '../Pagination';

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

type ExportFormat = 'csv' | 'xlsx' | 'json' | 'xml';

const formatLabels: Record<ExportFormat, string> = {
  csv: 'CSV',
  xlsx: l10n.t('Excel (XLSX)'),
  json: 'JSON',
  xml: 'XML',
};

export function TableDataView({ connectionId, table, schema, database }: TableDataViewProps) {
  const { columns, rows, totalRows, offset, primaryKeys, isLoading } = useTableDataStore();
  const [whereClause, setWhereClause] = useState('');
  const [appliedWhere, setAppliedWhere] = useState('');
  const [statusError, setStatusError] = useState<string | undefined>(undefined);
  const [editingCell, setEditingCell] = useState<CellEditInfo | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const sortRef = useRef<{ col?: string; dir?: 'asc' | 'desc' }>({});

  // Row selection state
  const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Inline insert row state (AG Grid pinnedTopRowData)
  const [insertingRow, setInsertingRow] = useState(false);
  const gridRef = useRef<AgGridReact>(null);

  // Export state
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Import state
  const [importStatus, setImportStatus] = useState<{
    type: 'progress' | 'success' | 'error';
    text: string;
  } | null>(null);

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

  const handleRefresh = useCallback(() => {
    const whereChanged = whereClause !== appliedWhere;
    setAppliedWhere(whereClause);
    fetchData({
      offset: whereChanged ? 0 : offset,
      where: whereClause,
    });
  }, [whereClause, appliedWhere, offset, fetchData]);

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
          setInsertingRow(false);
          setSelectedRows([]);
          setShowDeleteConfirm(false);
          setStatusError(undefined);
          fetchData({ offset });
        } else {
          const errMsg = msg.error ?? l10n.t('Save failed.');
          setStatusError(errMsg);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [offset, fetchData]);

  // Listen for export feedback
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'exportComplete') {
        setExportStatus({ type: 'success', text: l10n.t('Export complete: {0}', msg.filePath as string) });
        setTimeout(() => setExportStatus(null), 5000);
      } else if (msg?.type === 'exportError') {
        setExportStatus({ type: 'error', text: l10n.t('Export failed: {0}', msg.error as string) });
        setTimeout(() => setExportStatus(null), 5000);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Listen for import feedback
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'importProgress') {
        setImportStatus({ type: 'progress', text: l10n.t('Importing... {0}', msg.message as string) });
      } else if (msg?.type === 'importComplete') {
        setImportStatus({
          type: 'success',
          text: l10n.t('Import complete: {0} rows', String(msg.rowCount)),
        });
        setTimeout(() => setImportStatus(null), 5000);
        fetchData({ offset: 0 });
      } else if (msg?.type === 'importError') {
        setImportStatus({ type: 'error', text: l10n.t('Import failed: {0}', msg.error as string) });
        setTimeout(() => setImportStatus(null), 8000);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [fetchData]);

  // F5 새로고침
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'F5') return;
      if (editingCell || showDeleteConfirm || statusError || insertingRow || isLoading) return;
      e.preventDefault();
      handleRefresh();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingCell, showDeleteConfirm, statusError, insertingRow, isLoading, handleRefresh]);

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
      if (event.node?.rowPinned) return; // skip pinned insert row
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
        schema,
        primaryKey: pk,
        changes: { [editingCell.columnName]: newValue },
      }],
    });
  }, [editingCell, editValue, primaryKeys, connectionId, table, schema]);

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
        schema,
        primaryKey: pk,
        changes: { [editingCell.columnName]: null },
      }],
    });
  }, [editingCell, primaryKeys, connectionId, table, schema]);

  const handleExport = useCallback(
    (format: ExportFormat) => {
      postMessage({
        type: 'exportTableData',
        connectionId,
        table,
        schema,
        format,
        where: appliedWhere || undefined,
        sortColumn: sortRef.current.col,
        sortDirection: sortRef.current.dir,
      });
      setShowExportMenu(false);
    },
    [connectionId, table, schema, appliedWhere],
  );

  const handleImport = useCallback(() => {
    postMessage({ type: 'importData', connectionId, table, schema });
  }, [connectionId, table, schema]);

  const handleSelectionChanged = useCallback((event: SelectionChangedEvent) => {
    setSelectedRows(event.api.getSelectedRows() as Record<string, unknown>[]);
  }, []);

  const handleDeleteRows = useCallback(() => {
    if (selectedRows.length === 0) return;
    setShowDeleteConfirm(true);
  }, [selectedRows]);

  const handleConfirmDelete = useCallback(() => {
    const edits = selectedRows.map((row) => {
      const pk: Record<string, unknown> = {};
      for (const k of primaryKeys) {
        pk[k] = row[k];
      }
      return { type: 'delete' as const, table, schema, primaryKey: pk, changes: {} };
    });
    setIsSaving(true);
    setShowDeleteConfirm(false);
    postMessage({ type: 'saveTableEdits', connectionId, edits });
  }, [selectedRows, primaryKeys, table, schema, connectionId]);

  const handleAddRow = useCallback(() => {
    setInsertingRow(true);
  }, []);

  // Auto-focus first editable cell in pinned insert row
  useEffect(() => {
    const firstCol = columns[0];
    if (insertingRow && gridRef.current?.api && firstCol) {
      const timer = setTimeout(() => {
        gridRef.current?.api?.startEditingCell({
          rowIndex: 0,
          colKey: firstCol.name,
          rowPinned: 'top',
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [insertingRow, columns]);

  const handleInsertRow = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    api.stopEditing(); // commit current cell edit
    const pinnedRow = api.getPinnedTopRow(0);
    if (!pinnedRow) return;
    const rowData = pinnedRow.data as Record<string, unknown>;

    const changes: Record<string, unknown> = {};
    for (const col of columns) {
      const val = rowData[col.name];
      if (val === null || val === undefined || val === '') {
        if (col.nullable) {
          changes[col.name] = null;
        }
        // skip empty non-nullable (let DB handle default/auto-increment)
        continue;
      } else if (isBooleanType(col.type)) {
        changes[col.name] = val === 'true' || val === true;
      } else {
        changes[col.name] = val;
      }
    }
    setIsSaving(true);
    postMessage({
      type: 'saveTableEdits',
      connectionId,
      edits: [{ type: 'insert', table, schema, primaryKey: {}, changes }],
    });
  }, [columns, connectionId, table, schema]);

  // Pinned top row data for inline insert
  const pinnedTopRowData = useMemo(() => {
    if (!insertingRow) return undefined;
    const emptyRow: Record<string, unknown> = {};
    for (const col of columns) {
      emptyRow[col.name] = null;
    }
    return [emptyRow];
  }, [insertingRow, columns]);

  const colDefs = useMemo<ColDef[]>(
    () =>
      columns.map((col, idx) => {
        const isPk = primaryKeys.includes(col.name);
        return {
          field: col.name,
          headerName: `${col.name} (${col.type})`,
          headerTooltip: `${col.type}${col.nullable ? ' (nullable)' : ' (not null)'}${isPk ? ' [PK]' : ''}`,
          sortable: true,
          filter: true,
          resizable: true,
          minWidth: 80,
          editable: (params) => params.node?.rowPinned === 'top',
          ...(idx === 0 && canEdit
            ? {
                checkboxSelection: (params) => !params.node?.rowPinned,
                headerCheckboxSelection: true,
              }
            : {}),
          tooltipValueGetter: (params) => {
            if (params.node?.rowPinned === 'top') return `${col.name} (${col.type})`;
            return params.value !== null && params.value !== undefined
              ? String(params.value)
              : '(null)';
          },
          cellStyle: (params): Record<string, string> | null => {
            if (params.node?.rowPinned === 'top') return null;
            if (params.value === null || params.value === undefined) {
              return { color: 'var(--vscode-disabledForeground, #888)', fontStyle: 'italic' };
            }
            return null;
          },
          valueFormatter: (params) => {
            if (params.node?.rowPinned === 'top') {
              return params.value === null || params.value === undefined ? '' : String(params.value);
            }
            if (params.value === null || params.value === undefined) return '(null)';
            if (typeof params.value === 'object') return JSON.stringify(params.value);
            return String(params.value);
          },
        };
      }),
    [columns, primaryKeys, canEdit],
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
      <ContextHeader
        connectionId={connectionId}
        database={database}
        schema={schema}
        table={table}
        extraInfo={totalRows > 0 ? `${totalRows.toLocaleString()} rows` : undefined}
      />
      {/* WHERE filter bar + Export/Import */}
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
        <span style={{ opacity: 0.6, flexShrink: 0, fontWeight: 600 }}>{l10n.t('WHERE')}</span>
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
          {l10n.t('Apply')}
        </button>
        {appliedWhere && (
          <button
            className="secondary"
            onClick={handleClearWhere}
            style={{ fontSize: 11, padding: '2px 8px' }}
          >
            {l10n.t('Clear')}
          </button>
        )}
        {/* Refresh button — next to Apply */}
        <button
          className="secondary"
          style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
          onClick={handleRefresh}
          disabled={isLoading}
          title={l10n.t('Refresh')}
        >
          {l10n.t('Refresh')}
        </button>

        <span style={{ flex: 1 }} />

        {/* Status messages */}
        {exportStatus && (
          <span
            style={{
              fontSize: 11,
              flexShrink: 0,
              color: exportStatus.type === 'success'
                ? 'var(--vscode-testing-iconPassed, #73c991)'
                : 'var(--vscode-errorForeground, #f44)',
            }}
          >
            {exportStatus.text}
          </span>
        )}
        {importStatus && (
          <span
            style={{
              fontSize: 11,
              flexShrink: 0,
              color: importStatus.type === 'error'
                ? 'var(--vscode-errorForeground, #f44)'
                : importStatus.type === 'success'
                  ? 'var(--vscode-testing-iconPassed, #73c991)'
                  : 'var(--vscode-foreground)',
            }}
          >
            {importStatus.text}
          </span>
        )}

        {/* Delete button (visible when rows selected) */}
        {canEdit && selectedRows.length > 0 && (
          <button
            style={{
              fontSize: 11,
              padding: '2px 8px',
              flexShrink: 0,
              background: 'var(--vscode-errorForeground, #f44)',
              color: '#fff',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
            }}
            onClick={handleDeleteRows}
            disabled={isSaving}
          >
            {l10n.t('Delete')} ({selectedRows.length})
          </button>
        )}

        {/* Add Row / Insert+Cancel buttons */}
        {canEdit && !insertingRow && (
          <button
            className="secondary"
            style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
            onClick={handleAddRow}
            disabled={isSaving}
          >
            {l10n.t('+ Add Row')}
          </button>
        )}
        {canEdit && insertingRow && (
          <>
            <button
              style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
              onClick={handleInsertRow}
              disabled={isSaving}
            >
              {isSaving ? l10n.t('Saving...') : l10n.t('Insert')}
            </button>
            <button
              className="secondary"
              style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
              onClick={() => setInsertingRow(false)}
              disabled={isSaving}
            >
              {l10n.t('Cancel')}
            </button>
          </>
        )}

        {/* Import button */}
        <button
          className="secondary"
          style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
          onClick={handleImport}
          disabled={importStatus?.type === 'progress'}
        >
          {l10n.t('Import')}
        </button>

        {/* Export dropdown */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            className="secondary"
            style={{ fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}
            onClick={() => setShowExportMenu(!showExportMenu)}
          >
            {l10n.t('Export')} &#x25BE;
          </button>
          {showExportMenu && (
            <>
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 999,
                }}
                onClick={() => setShowExportMenu(false)}
              />
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
              >
                {(['csv', 'xlsx', 'json', 'xml'] as ExportFormat[]).map((fmt) => (
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
                    {formatLabels[fmt]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div
        className={isDark ? 'ag-theme-alpine-dark' : 'ag-theme-alpine'}
        style={{ flex: 1, minHeight: 0 }}
      >
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={colDefs}
          defaultColDef={defaultColDef}
          pinnedTopRowData={pinnedTopRowData}
          singleClickEdit={true}
          tooltipShowDelay={300}
          enableCellTextSelection={true}
          ensureDomOrder={true}
          rowSelection={canEdit ? 'multiple' : undefined}
          onSelectionChanged={canEdit ? handleSelectionChanged : undefined}
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
              <span style={{ fontWeight: 700, fontSize: 13 }}>{l10n.t('Edit Cell')}</span>
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
                <span style={{ fontSize: 10, opacity: 0.6 }}>{l10n.t('nullable')}</span>
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
                  {l10n.t('TRUE')}
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
                  {l10n.t('FALSE')}
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
                placeholder={editingCell.nullable ? l10n.t('Empty = NULL') : l10n.t('Enter value...')}
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
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              {editingCell.nullable && (
                <button
                  className="secondary"
                  onClick={handleSetNull}
                  disabled={isSaving}
                  style={{ fontSize: 11, padding: '3px 10px', marginRight: 'auto' }}
                >
                  {l10n.t('Set NULL')}
                </button>
              )}
              <button
                className="secondary"
                onClick={() => setEditingCell(null)}
                disabled={isSaving}
                style={{ fontSize: 11, padding: '3px 10px' }}
              >
                {l10n.t('Cancel')}
              </button>
              <button
                onClick={handleSaveCell}
                disabled={isSaving}
                style={{ fontSize: 11, padding: '3px 10px' }}
              >
                {isSaving ? l10n.t('Saving...') : l10n.t('Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error popup dialog */}
      {statusError && (
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
          onClick={(e) => { if (e.target === e.currentTarget) setStatusError(undefined); }}
        >
          <div
            style={{
              background: 'var(--vscode-editor-background, #1e1e1e)',
              border: '1px solid var(--vscode-panel-border, #333)',
              borderRadius: 6,
              padding: 16,
              minWidth: 300,
              maxWidth: '80vw',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--vscode-errorForeground, #f44)' }}>
                {l10n.t('Error:')}
              </span>
            </div>
            <div style={{
              fontSize: 12,
              marginBottom: 16,
              fontFamily: 'var(--vscode-editor-font-family, monospace)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {statusError}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setStatusError(undefined)}
                style={{ fontSize: 11, padding: '3px 10px' }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
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
          onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteConfirm(false); }}
        >
          <div
            style={{
              background: 'var(--vscode-editor-background, #1e1e1e)',
              border: '1px solid var(--vscode-panel-border, #333)',
              borderRadius: 6,
              padding: 16,
              minWidth: 300,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 13, marginBottom: 16 }}>
              {l10n.t('Delete {0} row(s)?', String(selectedRows.length))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="secondary"
                onClick={() => setShowDeleteConfirm(false)}
                style={{ fontSize: 11, padding: '3px 10px' }}
              >
                {l10n.t('Cancel')}
              </button>
              <button
                onClick={handleConfirmDelete}
                style={{
                  fontSize: 11,
                  padding: '3px 10px',
                  background: 'var(--vscode-errorForeground, #f44)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                {l10n.t('Delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
