import { createClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db';
import { forbidden, unauthorized } from './errors';

export interface AuthUser {
  id: string;
  phone?: string | null;
  email?: string | null;
}
/** Verifies a Supabase access token. Production impl asks Supabase Auth; tests inject a fake. */
export interface TokenVerifier {
  verify(token: string): Promise<AuthUser | null>;
}

export function supabaseVerifier(url: string, anonKey: string): TokenVerifier {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async verify(token) {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return null;
      return { id: data.user.id, phone: data.user.phone ?? null, email: data.user.email ?? null };
    },
  };
}

export interface AuthContext {
  userId: string;
  role: 'customer' | 'admin';
  profile: { fullName: string; phone: string | null; email: string | null };
}
declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    requestId?: string;
    rawBody?: Buffer;
  }
}

export function authenticate(verifier: TokenVerifier, db: Db) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization ?? '';
      const m = /^Bearer (.+)$/.exec(header);
      if (!m) throw unauthorized();
      const user = await verifier.verify(m[1]);
      if (!user) throw unauthorized('Invalid or expired session');
      // Role always comes from the database, never from client-controlled claims.
      const r = await db.query<{ role: 'customer' | 'admin'; full_name: string; phone: string | null; email: string | null; deleted_at: Date | null }>(
        'select role, full_name, phone, email, deleted_at from profiles where id = $1',
        [user.id],
      );
      let row = r.rows[0];
      if (!row) {
        await db.query(
          'insert into profiles (id, phone, email) values ($1,$2,$3) on conflict (id) do nothing',
          [user.id, user.phone ?? null, user.email ?? null],
        );
        row = { role: 'customer', full_name: '', phone: user.phone ?? null, email: user.email ?? null, deleted_at: null };
      }
      if (row.deleted_at) throw forbidden('This account has been deleted');
      req.auth = {
        userId: user.id,
        role: row.role,
        profile: { fullName: row.full_name, phone: row.phone, email: row.email },
      };
      next();
    } catch (e) {
      next(e);
    }
  };
}

export const requireRole = (...roles: Array<'customer' | 'admin'>) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(unauthorized());
  if (!roles.includes(req.auth.role)) return next(forbidden());
  next();
};
