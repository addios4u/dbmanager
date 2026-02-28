import { create } from 'zustand';
import type { ColumnMeta } from '@dbmanager/shared';
import { PAGE_SIZE } from '@dbmanager/shared/src/constants';

interface ResultsStore {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  totalRows: number;
  executionTime: number;
  offset: number;
  pageSize: number;
  error: string | null;
  setResults: (
    columns: ColumnMeta[],
    rows: Record<string, unknown>[],
    totalRows: number,
    executionTime: number,
    offset?: number,
  ) => void;
  setError: (error: string) => void;
  clear: () => void;
}

export const useResultsStore = create<ResultsStore>((set) => ({
  columns: [],
  rows: [],
  totalRows: 0,
  executionTime: 0,
  offset: 0,
  pageSize: PAGE_SIZE,
  error: null,
  setResults: (columns, rows, totalRows, executionTime, offset = 0) =>
    set({ columns, rows, totalRows, executionTime, offset, error: null }),
  setError: (error) => set({ error }),
  clear: () =>
    set({ columns: [], rows: [], totalRows: 0, executionTime: 0, offset: 0, error: null }),
}));
