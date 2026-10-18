import type { Config } from './config';
import type { Db } from './db';
import type { TokenVerifier } from './auth';
import type { Logger } from './logger';
import type { Notifier } from './notify';
import type { PaymentProvider } from './payments/provider';

export interface Deps {
  db: Db;
  verifier: TokenVerifier;
  payments: PaymentProvider;
  notifier: Notifier;
  log: Logger;
  config: Config;
  now: () => Date;
  /** Removes the Supabase auth user on account deletion (service role). Optional. */
  deleteAuthUser?: (userId: string) => Promise<void>;
}
