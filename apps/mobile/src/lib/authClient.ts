import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { config } from './config';
import { secureStorage } from './secureStorage';
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

// ---------------------------------------------------------------- test login (shared test code, no SMS)
const TEST_KEY = 'test-session';
const testListeners = new Set<Listener>();

function testSession(token: string, phone: string, expiresAt: string): Session {
  return {
    access_token: token,
    refresh_token: 'test',
    token_type: 'bearer',
    expires_in: Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)),
    expires_at: Math.floor(Date.parse(expiresAt) / 1000),
    user: { id: phone, phone, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: new Date().toISOString() },
  } as Session;
}

const testAuth: AuthClient = {
  async signInWithOtp() {
    return { error: null }; // nothing is sent; the user enters the shared test code
  },
  async verifyOtp({ phone, token }) {
    try {
      const res = await fetch(`${config.apiUrl}/auth/test-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ phone, code: token }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = res.status === 401 ? 'Token has expired or is invalid' : json?.error?.message ?? 'Sign-in failed. Please try again.';
        return { error: { message: msg } };
      }
      const { accessToken, expiresAt } = json.data as { accessToken: string; expiresAt: string };
      await secureStorage.setItem(TEST_KEY, JSON.stringify({ accessToken, expiresAt, phone }));
      const s = testSession(accessToken, phone, expiresAt);
      testListeners.forEach((l) => l('SIGNED_IN', s));
      return { error: null };
    } catch {
      return { error: { message: 'Cannot reach the server. Check your connection and try again.' } };
    }
  },
  async getSession() {
    try {
      const raw = await secureStorage.getItem(TEST_KEY);
      if (!raw) return { data: { session: null } };
      const { accessToken, expiresAt, phone } = JSON.parse(raw);
      if (Date.parse(expiresAt) <= Date.now()) return { data: { session: null } };
      return { data: { session: testSession(accessToken, phone, expiresAt) } };
    } catch {
      return { data: { session: null } };
    }
  },
  onAuthStateChange(cb) {
    testListeners.add(cb);
    return { data: { subscription: { unsubscribe: () => testListeners.delete(cb) } } };
  },
  async signOut() {
    try { await secureStorage.removeItem(TEST_KEY); } catch { /* ignore */ }
    testListeners.forEach((l) => l('SIGNED_OUT', null));
  },
};

export const authClient = (): AuthClient =>
  config.demoMode ? demoAuth : config.testLogin ? testAuth : (supabase.auth as unknown as AuthClient);
