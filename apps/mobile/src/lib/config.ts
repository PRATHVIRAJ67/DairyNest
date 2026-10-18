import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

export const config = {
  appName: 'Meadowpail',
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? 'http://localhost:4000/api/v1',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'support@example.com',
  supportPhone: process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? '',
  /**
   * Local demo mode: fixed OTP code and simulated payments against the demo API (services/api/scripts/local-demo.ts).
   * Only honoured in development builds, so a release build can never ship with it on.
   */
  // EXPO_PUBLIC_DEMO_BUILD is set only by the "demo" EAS profile, which also builds a separate app id.
  demoMode:
    process.env.EXPO_PUBLIC_DEMO_MODE === '1' &&
    ((typeof __DEV__ === 'undefined' || __DEV__) || process.env.EXPO_PUBLIC_DEMO_BUILD === '1'),
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? (Constants.expoConfig?.extra as any)?.eas?.projectId ?? '',
};

export const isConfigured = () => config.demoMode || (!!config.supabaseUrl && !!config.supabaseAnonKey);
