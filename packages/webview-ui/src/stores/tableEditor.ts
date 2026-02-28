import { create } from 'zustand';
import type { TableEdit } from '@dbmanager/shared';

function serializeKey(primaryKeys: string[], row: Record<string, unknown>): string {
  const keyObj: Record<string, unknown> = {};
  for (const pk of primaryKeys) {
    keyObj[pk] = row[pk];
  }
  return JSON.stringify(keyObj);
}

interface TableEditorStore {
  // Track updates: serialized PK -> { column: newValue }
  dirtyRows: Record<string, Record<string, unknown>>;
  // Track original values for dirty rows
  originalValues: Record<string, Record<string, unknown>>;
  // Deleted row PKs
  deletedRowKeys: Set<string>;
  // Inserted rows
  insertedRows: Record<string, unknown>[];
  // Computed
  hasChanges: boolean;
  changeCount: number;

  trackUpdate(
    primaryKeys: string[],
    row: Record<string, unknown>,
    column: string,
    newValue: unknown,
    oldValue: unknown,
  ): void;
  trackDelete(primaryKeys: string[], row: Record<string, unknown>): void;
  trackInsert(row: Record<string, unknown>): void;
  removeInsertedRow(index: number): void;
  discardChanges(): void;
  getEdits(table: string): TableEdit[];
  isRowDeleted(primaryKeys: string[], row: Record<string, unknown>): boolean;
  isCellDirty(primaryKeys: string[], row: Record<string, unknown>, column: string): boolean;
  clear(): void;
}

function computeHasChanges(
  dirtyRows: Record<string, Record<string, unknown>>,
  deletedRowKeys: Set<string>,
  insertedRows: Record<string, unknown>[],
): boolean {
  return (
    Object.keys(dirtyRows).length > 0 ||
    deletedRowKeys.size > 0 ||
    insertedRows.length > 0
  );
}

function computeChangeCount(
  dirtyRows: Record<string, Record<string, unknown>>,
  deletedRowKeys: Set<string>,
  insertedRows: Record<string, unknown>[],
): number {
  return Object.keys(dirtyRows).length + deletedRowKeys.size + insertedRows.length;
}

export const useTableEditorStore = create<TableEditorStore>((set, get) => ({
  dirtyRows: {},
  originalValues: {},
  deletedRowKeys: new Set(),
  insertedRows: [],
  hasChanges: false,
  changeCount: 0,

  trackUpdate: (primaryKeys, row, column, newValue, oldValue) => {
    set((state) => {
      const key = serializeKey(primaryKeys, row);
      const nextDirtyRows = { ...state.dirtyRows };
      const nextOriginalValues = { ...state.originalValues };

      if (!nextDirtyRows[key]) {
        nextDirtyRows[key] = {};
      }
      if (!nextOriginalValues[key]) {
        nextOriginalValues[key] = {};
      }

      nextDirtyRows[key] = { ...nextDirtyRows[key], [column]: newValue };

      // Only store original value the first time this cell is changed
      if (!(column in nextOriginalValues[key])) {
        nextOriginalValues[key] = { ...nextOriginalValues[key], [column]: oldValue };
      }

      const hasChanges = computeHasChanges(nextDirtyRows, state.deletedRowKeys, state.insertedRows);
      const changeCount = computeChangeCount(nextDirtyRows, state.deletedRowKeys, state.insertedRows);

      return { dirtyRows: nextDirtyRows, originalValues: nextOriginalValues, hasChanges, changeCount };
    });
  },

  trackDelete: (primaryKeys, row) => {
    set((state) => {
      const key = serializeKey(primaryKeys, row);
      const nextDeleted = new Set(state.deletedRowKeys);
      nextDeleted.add(key);

      // Remove from dirty rows if present
      const nextDirtyRows = { ...state.dirtyRows };
      delete nextDirtyRows[key];
      const nextOriginalValues = { ...state.originalValues };
      delete nextOriginalValues[key];

      const hasChanges = computeHasChanges(nextDirtyRows, nextDeleted, state.insertedRows);
      const changeCount = computeChangeCount(nextDirtyRows, nextDeleted, state.insertedRows);

      return {
        deletedRowKeys: nextDeleted,
        dirtyRows: nextDirtyRows,
        originalValues: nextOriginalValues,
        hasChanges,
        changeCount,
      };
    });
  },

  trackInsert: (row) => {
    set((state) => {
      const nextInserted = [...state.insertedRows, row];
      const hasChanges = computeHasChanges(state.dirtyRows, state.deletedRowKeys, nextInserted);
      const changeCount = computeChangeCount(state.dirtyRows, state.deletedRowKeys, nextInserted);
      return { insertedRows: nextInserted, hasChanges, changeCount };
    });
  },

  removeInsertedRow: (index) => {
    set((state) => {
      const nextInserted = state.insertedRows.filter((_, i) => i !== index);
      const hasChanges = computeHasChanges(state.dirtyRows, state.deletedRowKeys, nextInserted);
      const changeCount = computeChangeCount(state.dirtyRows, state.deletedRowKeys, nextInserted);
      return { insertedRows: nextInserted, hasChanges, changeCount };
    });
  },

  discardChanges: () => {
    set({
      dirtyRows: {},
      originalValues: {},
      deletedRowKeys: new Set(),
      insertedRows: [],
      hasChanges: false,
      changeCount: 0,
    });
  },

  getEdits: (table) => {
    const { dirtyRows, deletedRowKeys, insertedRows } = get();
    const edits: TableEdit[] = [];

    for (const [serializedKey, changes] of Object.entries(dirtyRows)) {
      const primaryKey = JSON.parse(serializedKey) as Record<string, unknown>;
      edits.push({ type: 'update', table, primaryKey, changes });
    }

    for (const serializedKey of deletedRowKeys) {
      const primaryKey = JSON.parse(serializedKey) as Record<string, unknown>;
      edits.push({ type: 'delete', table, primaryKey, changes: {} });
    }

    for (const row of insertedRows) {
      edits.push({ type: 'insert', table, primaryKey: {}, changes: row });
    }

    return edits;
  },

  isRowDeleted: (primaryKeys, row) => {
    const key = serializeKey(primaryKeys, row);
    return get().deletedRowKeys.has(key);
  },

  isCellDirty: (primaryKeys, row, column) => {
    const key = serializeKey(primaryKeys, row);
    const dirty = get().dirtyRows[key];
    return dirty !== undefined && column in dirty;
  },

  clear: () => {
    set({
      dirtyRows: {},
      originalValues: {},
      deletedRowKeys: new Set(),
      insertedRows: [],
      hasChanges: false,
      changeCount: 0,
    });
  },
}));
