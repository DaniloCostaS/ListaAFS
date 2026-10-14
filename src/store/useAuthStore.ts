import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  isInitialized: boolean;
  setSession: (session: Session | null) => void;
  setInitialized: (status: boolean) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  isInitialized: false,
  setSession: (session) => set({ session, user: session?.user || null }),
  setInitialized: (status) => set({ isInitialized: status }),
  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null });
  },
}));

// Initialize auth state listener
supabase.auth.onAuthStateChange((_event, session) => {
  useAuthStore.getState().setSession(session);
});
