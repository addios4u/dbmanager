import { create } from 'zustand';
import type { ColumnMeta } from '@dbmanager/shared';
import { PAGE_SIZE } from '@dbmanager/shared/src/constants';

export interface MultiQueryStatementResult {
  index: number;
  sql: string;
  status: 'ok' | 'error';
  executionTime: number;
  affectedRows?: number;
  columns?: ColumnMeta[];
  rows?: Record<string, unknown>[];
  error?: string;
}

interface ResultsStore {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  totalRows: number;
  executionTime: number;
  offset: number;
  pageSize: number;
  error: string | null;
  multiResults: MultiQueryStatementResult[] | null;
  multiTotalTime: number;
  setResults: (
    columns: ColumnMeta[],
    rows: Record<string, unknown>[],
    totalRows: number,
    executionTime: number,
    offset?: number,
  ) => void;
  setMultiResults: (results: MultiQueryStatementResult[], totalTime: number) => void;
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
  multiResults: null,
  multiTotalTime: 0,
  setResults: (columns, rows, totalRows, executionTime, offset = 0) =>
    set({ columns, rows, totalRows, executionTime, offset, error: null, multiResults: null }),
  setMultiResults: (results, totalTime) => {
    // 마지막 SELECT 결과가 있으면 ResultsGrid에도 표시
    const lastSelect = [...results].reverse().find(
      (r) => r.status === 'ok' && r.columns && r.columns.length > 0,
    );
    set({
      multiResults: results,
      multiTotalTime: totalTime,
      error: null,
      columns: lastSelect?.columns ?? [],
      rows: lastSelect?.rows ?? [],
      totalRows: lastSelect?.rows?.length ?? 0,
      executionTime: lastSelect?.executionTime ?? 0,
      offset: 0,
    });
  },
  setError: (error) => set({ error, multiResults: null, multiTotalTime: 0 }),
  clear: () =>
    set({ columns: [], rows: [], totalRows: 0, executionTime: 0, offset: 0, error: null, multiResults: null, multiTotalTime: 0 }),
}));
