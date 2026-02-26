import { create } from 'zustand';

interface QueryStore {
  sql: string;
  isExecuting: boolean;
  queryId: string | null;
  setSql: (sql: string) => void;
  setExecuting: (executing: boolean, queryId?: string) => void;
}

export const useQueryStore = create<QueryStore>((set) => ({
  sql: '',
  isExecuting: false,
  queryId: null,
  setSql: (sql) => set({ sql }),
  setExecuting: (executing, queryId) =>
    set({ isExecuting: executing, queryId: queryId ?? null }),
}));
