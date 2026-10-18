import { createClient } from '@supabase/supabase-js';
import { supabaseVerifier } from './auth';
import type { Config } from './config';
import type { Db } from './db';
import type { Deps } from './deps';
import type { Logger } from './logger';
import { ExpoPushSender, Notifier } from './notify';
import { RazorpayProvider, UnconfiguredProvider } from './payments/provider';

/** Wires real providers from configuration. Shared by the Node server and the Cloudflare Worker. */
export function buildDeps(config: Config, log: Logger, db: Db): Deps {
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

  return {
    db,
    verifier: supabaseVerifier(config.SUPABASE_URL, config.SUPABASE_ANON_KEY),
    payments,
    notifier: new Notifier(new ExpoPushSender(config.EXPO_ACCESS_TOKEN), log),
    log,
    config,
    now: () => new Date(),
    deleteAuthUser,
  };
}
