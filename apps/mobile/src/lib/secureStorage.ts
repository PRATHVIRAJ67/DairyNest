import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Supabase session storage backed by the OS keychain/keystore (expo-secure-store).
 * Values are chunked because SecureStore warns above ~2 KB and a session JWT can exceed that.
 * On web (dev preview only) it falls back to localStorage, which is not secure storage.
 */
const CHUNK = 1500;
const countKey = (k: string) => `${k}.n`;
const chunkKey = (k: string, i: number) => `${k}.${i}`;
const safe = (k: string) => k.replace(/[^\w.-]/g, '_');

export const secureStorage = {
  async getItem(rawKey: string): Promise<string | null> {
    const key = safe(rawKey);
    if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    const n = await SecureStore.getItemAsync(countKey(key));
    if (!n) return null;
    const parts: string[] = [];
    for (let i = 0; i < Number(n); i++) {
      const p = await SecureStore.getItemAsync(chunkKey(key, i));
      if (p === null) return null;
      parts.push(p);
    }
    return parts.join('');
  },
  async setItem(rawKey: string, value: string): Promise<void> {
    const key = safe(rawKey);
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
      return;
    }
    await secureStorage.removeItem(rawKey);
    const chunks = value.match(new RegExp(`.{1,${CHUNK}}`, 'gs')) ?? [''];
    for (let i = 0; i < chunks.length; i++) await SecureStore.setItemAsync(chunkKey(key, i), chunks[i]);
    await SecureStore.setItemAsync(countKey(key), String(chunks.length));
  },
  async removeItem(rawKey: string): Promise<void> {
    const key = safe(rawKey);
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
      return;
    }
    const n = Number((await SecureStore.getItemAsync(countKey(key))) ?? 0);
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(chunkKey(key, i));
    await SecureStore.deleteItemAsync(countKey(key));
  },
};
