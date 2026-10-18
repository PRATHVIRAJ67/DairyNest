import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';
import { authClient } from '@/lib/authClient';

interface AuthState {
  session: Session | null;
  ready: boolean;
  onboarded: boolean;
  init: () => Promise<() => void>;
  finishOnboarding: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  session: null,
  ready: false,
  onboarded: false,
  async init() {
    let onboarded = false;
    try {
      onboarded = (await AsyncStorage.getItem('onboarded')) === '1';
    } catch {
      /* storage unavailable: show onboarding */
    }
    const { data } = await authClient().getSession();
    set({ session: data.session, onboarded, ready: true });
    const { data: sub } = authClient().onAuthStateChange((_event, session) => set({ session }));
    return () => sub.subscription.unsubscribe();
  },
  async finishOnboarding() {
    set({ onboarded: true });
    try {
      await AsyncStorage.setItem('onboarded', '1');
    } catch {
      /* non-fatal */
    }
  },
  async signOut() {
    await authClient().signOut();
    set({ session: null });
  },
}));
