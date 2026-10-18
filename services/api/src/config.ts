import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('*'),
  /** Postgres connection string (Supabase: Project Settings > Database > Connection string, use the pooler). */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(10),
  /** Needed only to delete the auth user on account deletion. Server-side only. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /**
   * TESTING ONLY (see src/testing.ts). With both set, any phone number can sign in with TEST_LOGIN_CODE instead of an
   * SMS OTP. Remove them before real customers use the app.
   */
  TEST_LOGIN_CODE: z.string().regex(/^\d{6}$/, 'TEST_LOGIN_CODE must be 6 digits').optional(),
  TEST_SESSION_SECRET: z.string().min(32, 'TEST_SESSION_SECRET must be at least 32 characters').optional(),
  /** TESTING ONLY: "simulated" replaces Razorpay with signature-checked fake payments (needs TEST_SESSION_SECRET). */
  PAYMENTS_MODE: z.enum(['razorpay', 'simulated']).default('razorpay'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.CORS_ORIGINS === '*') {
    throw new Error('CORS_ORIGINS must be set explicitly in production');
  }
  return parsed.data;
}
