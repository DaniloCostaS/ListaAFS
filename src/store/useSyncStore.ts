import { create } from 'zustand';
import { syncEngine } from '../services/syncEngine';

interface SyncState {
  isSyncing: boolean;
  lastSyncedAt: number | null;
  error: string | null;
  runSync: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set) => ({
  isSyncing: false,
  lastSyncedAt: null,
  error: null,
  runSync: async () => {
    set({ isSyncing: true, error: null });
    try {
      await syncEngine.sync();
      set({ isSyncing: false, lastSyncedAt: Date.now() });
    } catch (error) {
      set({ 
        isSyncing: false, 
        error: error instanceof Error ? error.message : 'Unknown sync error' 
      });
    }
  },
}));
