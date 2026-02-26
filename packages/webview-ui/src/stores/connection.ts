import { create } from 'zustand';
import type { ConnectionInfo } from '@dbmanager/shared';

interface ConnectionStore {
  connections: ConnectionInfo[];
  activeConnectionId: string | null;
  setConnections: (connections: ConnectionInfo[]) => void;
  setActiveConnection: (id: string | null) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connections: [],
  activeConnectionId: null,
  setConnections: (connections) => set({ connections }),
  setActiveConnection: (id) => set({ activeConnectionId: id }),
}));
