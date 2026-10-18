import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { config } from './config';
import { supabase } from './supabase';

type Result = Promise<{ error: { message: string } | null }>;
type Listener = (event: string, session: Session | null) => void;

/** The small part of Supabase Auth the app uses. */
export interface AuthClient {
  signInWithOtp(a: { phone: string }): Result;
  verifyOtp(a: { phone: string; token: string; type: 'sms' }): Result;
  getSession(): Promise<{ data: { session: Session | null } }>;
  onAuthStateChange(cb: Listener): { data: { subscription: { unsubscribe(): void } } };
  signOut(): Promise<unknown>;
}

export const DEMO_OTP = '123456';
const KEY = 'demo-session';
const listeners = new Set<Listener>();

function demoSession(phone: string): Session {
  return {
    access_token: `demo:${phone}`,
    refresh_token: 'demo',
    token_type: 'bearer',
    expires_in: 60 * 60 * 24 * 365,
    user: { id: phone, phone, app_metadata: {}, user_metadata: {}, aud: 'demo', created_at: new Date().toISOString() },
  } as Session;
}

/** Development-only stand-in for SMS OTP. Accepts any valid number with the code 123456. */
const demoAuth: AuthClient = {
  async signInWithOtp() {
    return { error: null };
  },
  async verifyOtp({ phone, token }) {
    if (token !== DEMO_OTP) return { error: { message: 'Token has expired or is invalid' } };
    const s = demoSession(phone);
    try { await AsyncStorage.setItem(KEY, phone); } catch { /* session lasts until the app closes */ }
    listeners.forEach((l) => l('SIGNED_IN', s));
    return { error: null };
  },
  async getSession() {
    let phone: string | null = null;
    try { phone = await AsyncStorage.getItem(KEY); } catch { /* treat as signed out */ }
    return { data: { session: phone ? demoSession(phone) : null } };
  },
  onAuthStateChange(cb) {
    listeners.add(cb);
    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
  },
  async signOut() {
    try { await AsyncStorage.removeItem(KEY); } catch { /* ignore */ }
    listeners.forEach((l) => l('SIGNED_OUT', null));
  },
};

export const authClient = (): AuthClient => (config.demoMode ? demoAuth : (supabase.auth as unknown as AuthClient));
