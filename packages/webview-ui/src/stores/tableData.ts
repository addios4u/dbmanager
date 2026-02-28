import { create } from 'zustand';
import type { ColumnMeta } from '@dbmanager/shared';
import { PAGE_SIZE } from '@dbmanager/shared/src/constants';

interface TableDataStore {
  connectionId: string | null;
  table: string | null;
  schema: string | null;
  database: string | null;
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  totalRows: number;
  offset: number;
  pageSize: number;
  primaryKeys: string[];
  isLoading: boolean;

  setTableData(data: {
    connectionId: string;
    table: string;
    schema?: string | null;
    database?: string | null;
    columns: ColumnMeta[];
    rows: Record<string, unknown>[];
    totalRows: number;
    offset: number;
    primaryKeys: string[];
  }): void;
  setLoading(loading: boolean): void;
  clear(): void;
}

export const useTableDataStore = create<TableDataStore>((set) => ({
  connectionId: null,
  table: null,
  schema: null,
  database: null,
  columns: [],
  rows: [],
  totalRows: 0,
  offset: 0,
  pageSize: PAGE_SIZE,
  primaryKeys: [],
  isLoading: false,

  setTableData: (data) =>
    set({
      connectionId: data.connectionId,
      table: data.table,
      schema: data.schema ?? null,
      database: data.database ?? null,
      columns: data.columns,
      rows: data.rows,
      totalRows: data.totalRows,
      offset: data.offset,
      primaryKeys: data.primaryKeys,
      isLoading: false,
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  clear: () =>
    set({
      connectionId: null,
      table: null,
      schema: null,
      database: null,
      columns: [],
      rows: [],
      totalRows: 0,
      offset: 0,
      primaryKeys: [],
      isLoading: false,
    }),
}));
