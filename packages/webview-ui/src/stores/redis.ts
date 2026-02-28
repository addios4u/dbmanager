import { create } from 'zustand';
import type { RedisKeyInfo, RedisValue } from '@dbmanager/shared';

interface RedisStore {
  connectionId: string | null;
  currentDb: number;
  pattern: string;
  keys: RedisKeyInfo[];
  cursor: string;
  hasMore: boolean;
  selectedKey: string | null;
  selectedValue: RedisValue | null;
  isScanning: boolean;
  isLoadingValue: boolean;

  setKeys(keys: RedisKeyInfo[], cursor: string, hasMore: boolean, append: boolean): void;
  setSelectedValue(value: RedisValue): void;
  setCurrentDb(db: number): void;
  setPattern(pattern: string): void;
  selectKey(key: string | null): void;
  setScanning(scanning: boolean): void;
  setLoadingValue(loading: boolean): void;
  clear(): void;
}

export const useRedisStore = create<RedisStore>((set) => ({
  connectionId: null,
  currentDb: 0,
  pattern: '*',
  keys: [],
  cursor: '0',
  hasMore: false,
  selectedKey: null,
  selectedValue: null,
  isScanning: false,
  isLoadingValue: false,

  setKeys: (keys, cursor, hasMore, append) =>
    set((state) => ({
      keys: append ? [...state.keys, ...keys] : keys,
      cursor,
      hasMore,
      isScanning: false,
    })),

  setSelectedValue: (value) => set({ selectedValue: value, isLoadingValue: false }),

  setCurrentDb: (db) => set({ currentDb: db, keys: [], cursor: '0', hasMore: false, selectedKey: null, selectedValue: null }),

  setPattern: (pattern) => set({ pattern }),

  selectKey: (key) => set({ selectedKey: key, selectedValue: null }),

  setScanning: (scanning) => set({ isScanning: scanning }),

  setLoadingValue: (loading) => set({ isLoadingValue: loading }),

  clear: () =>
    set({
      connectionId: null,
      currentDb: 0,
      pattern: '*',
      keys: [],
      cursor: '0',
      hasMore: false,
      selectedKey: null,
      selectedValue: null,
      isScanning: false,
      isLoadingValue: false,
    }),
}));
