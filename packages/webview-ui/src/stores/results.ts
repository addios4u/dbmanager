import { create } from 'zustand';
import type { ColumnMeta } from '@dbmanager/shared';

interface ResultsStore {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  totalRows: number;
  executionTime: number;
  error: string | null;
  setResults: (
    columns: ColumnMeta[],
    rows: Record<string, unknown>[],
    totalRows: number,
    executionTime: number,
  ) => void;
  setError: (error: string) => void;
  clear: () => void;
}

export const useResultsStore = create<ResultsStore>((set) => ({
  columns: [],
  rows: [],
  totalRows: 0,
  executionTime: 0,
  error: null,
  setResults: (columns, rows, totalRows, executionTime) =>
    set({ columns, rows, totalRows, executionTime, error: null }),
  setError: (error) => set({ error }),
  clear: () =>
    set({ columns: [], rows: [], totalRows: 0, executionTime: 0, error: null }),
}));
