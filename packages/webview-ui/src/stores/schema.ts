import { create } from 'zustand';
import type { DatabaseInfo } from '@dbmanager/shared';

interface SchemaStore {
  databases: DatabaseInfo[];
  setDatabases: (databases: DatabaseInfo[]) => void;
}

export const useSchemaStore = create<SchemaStore>((set) => ({
  databases: [],
  setDatabases: (databases) => set({ databases }),
}));
