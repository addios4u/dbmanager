import { create } from 'zustand';

interface QueryStore {
  sql: string;
  isExecuting: boolean;
  queryId: string | null;
  databases: string[];
  schemas: string[];
  database: string | undefined;
  schema: string | undefined;
  setSql: (sql: string) => void;
  setExecuting: (executing: boolean, queryId?: string) => void;
  setDatabases: (databases: string[]) => void;
  setSchemas: (schemas: string[]) => void;
  setDatabase: (database: string | undefined) => void;
  setSchema: (schema: string | undefined) => void;
}

export const useQueryStore = create<QueryStore>((set) => ({
  sql: '',
  isExecuting: false,
  queryId: null,
  databases: [],
  schemas: [],
  database: undefined,
  schema: undefined,
  setSql: (sql) => set({ sql }),
  setExecuting: (executing, queryId) =>
    set({ isExecuting: executing, queryId: queryId ?? null }),
  setDatabases: (databases) => set({ databases }),
  setSchemas: (schemas) => set({ schemas }),
  setDatabase: (database) => set({ database }),
  setSchema: (schema) => set({ schema }),
}));
