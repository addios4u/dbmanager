import { create } from 'zustand';

export type AiProvider = 'openai' | 'google';
export type AiMode = 'generate' | 'refine';
export type InsertMode = 'replace' | 'append';

interface PendingResult {
  sql: string;
  mode: 'generate' | 'refine';
}

interface AiStore {
  provider: AiProvider;
  mode: AiMode;
  prompt: string;
  instruction: string;
  selectedSql: string;
  insertMode: InsertMode;
  isGenerating: boolean;
  error: string | null;
  isPanelOpen: boolean;
  keyStatus: Record<AiProvider, boolean>;
  pendingResult: PendingResult | null;
  // Actions
  setProvider: (provider: AiProvider) => void;
  setMode: (mode: AiMode) => void;
  setPrompt: (prompt: string) => void;
  setInstruction: (instruction: string) => void;
  setSelectedSql: (sql: string) => void;
  setInsertMode: (mode: InsertMode) => void;
  setGenerating: (generating: boolean) => void;
  setError: (error: string | null) => void;
  setPanelOpen: (open: boolean) => void;
  setKeyStatus: (provider: AiProvider, hasKey: boolean) => void;
  setPendingResult: (result: PendingResult | null) => void;
}

export const useAiStore = create<AiStore>((set) => ({
  provider: 'openai',
  mode: 'generate',
  prompt: '',
  instruction: '',
  selectedSql: '',
  insertMode: 'append',
  isGenerating: false,
  error: null,
  isPanelOpen: false,
  keyStatus: { openai: false, google: false },
  pendingResult: null,
  setProvider: (provider) => set({ provider }),
  setMode: (mode) => set({ mode }),
  setPrompt: (prompt) => set({ prompt }),
  setInstruction: (instruction) => set({ instruction }),
  setSelectedSql: (selectedSql) => set({ selectedSql }),
  setInsertMode: (insertMode) => set({ insertMode }),
  setGenerating: (generating) => set({ isGenerating: generating }),
  setError: (error) => set({ error }),
  setPanelOpen: (open) => set({ isPanelOpen: open }),
  setKeyStatus: (provider, hasKey) =>
    set((s) => ({ keyStatus: { ...s.keyStatus, [provider]: hasKey } })),
  setPendingResult: (result) => set({ pendingResult: result }),
}));
