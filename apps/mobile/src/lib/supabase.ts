import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { config } from './config';
import { secureStorage } from './secureStorage';

// Only the public anon key lives in the app. The service-role key must never be shipped here.
export const supabase = createClient(config.supabaseUrl || 'http://localhost:54321', config.supabaseAnonKey || 'missing-anon-key', {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

if (Platform.OS !== 'web') {
  // Refresh tokens only while the app is in the foreground.
  AppState.addEventListener('change', (s) => {
    if (s === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
