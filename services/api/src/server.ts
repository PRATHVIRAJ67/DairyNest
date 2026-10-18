import { createClient } from '@supabase/supabase-js';
import { supabaseVerifier } from './auth';
import { createApp } from './app';
import { loadConfig } from './config';
import { createPgDb } from './db';
import { createLogger } from './logger';
import { ExpoPushSender, Notifier } from './notify';
import { RazorpayProvider, UnconfiguredProvider } from './payments/provider';
import type { Deps } from './deps';

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL);

const payments =
  config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET
    ? new RazorpayProvider(config.RAZORPAY_KEY_ID, config.RAZORPAY_KEY_SECRET, config.RAZORPAY_WEBHOOK_SECRET)
    : new UnconfiguredProvider();
if (!payments.isConfigured()) log.warn('Razorpay credentials missing: checkout endpoints will return PAYMENT_NOT_CONFIGURED');
if (payments.isConfigured() && !config.RAZORPAY_WEBHOOK_SECRET) log.warn('RAZORPAY_WEBHOOK_SECRET missing: webhooks will be rejected');

let deleteAuthUser: Deps['deleteAuthUser'];
if (config.SUPABASE_SERVICE_ROLE_KEY) {
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  deleteAuthUser = async (id) => {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) log.error({ err: error }, 'failed to delete auth user');
  };
}

const deps: Deps = {
  db: createPgDb(config.DATABASE_URL),
  verifier: supabaseVerifier(config.SUPABASE_URL, config.SUPABASE_ANON_KEY),
  payments,
  notifier: new Notifier(new ExpoPushSender(config.EXPO_ACCESS_TOKEN), log),
  log,
  config,
  now: () => new Date(),
  deleteAuthUser,
};

const app = createApp(deps);
const server = app.listen(config.PORT, '0.0.0.0', () => log.info(`API listening on :${config.PORT} (docs at /api/v1/docs)`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log.info(`${sig} received, shutting down`);
    server.close(() => void deps.db.close().finally(() => process.exit(0)));
  });
}
