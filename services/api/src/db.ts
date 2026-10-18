import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import pg from 'pg';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}
export interface Db extends Queryable {
  /** Run fn inside a single transaction. Rolls back on throw. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Keep DATE as 'YYYY-MM-DD' strings and bigint/numeric as numbers where safe.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false },
  });
  return {
    async query(sql, params) {
      const r = await pool.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const q: Queryable = {
          async query(sql, params) {
            const r = await client.query(sql, params as any[]);
            return { rows: r.rows, rowCount: r.rowCount ?? 0 };
          },
        };
        const out = await fn(q);
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export function camel<T = any>(row: any): T {
  if (Array.isArray(row)) return row.map(camel) as any;
  if (row && typeof row === 'object' && !(row instanceof Date)) {
    const out: any = {};
    for (const [k, v] of Object.entries(row)) {
      out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = camel(v);
    }
    return out;
  }
  return row;
}

/**
 * Cloudflare Workers variant: a connection cannot be shared between requests there, so each HTTP request gets its own
 * client (opened lazily, closed when the response ends). Queries and transactions within a request share it.
 * Pooling is done by Supabase's pooler (or Cloudflare Hyperdrive when configured).
 */
interface Holder { client?: Promise<pg.Client>; txDepth: number; }

export function createRequestScopedPgDb(
  connectionString: string,
  opts: { ssl: boolean },
): Db & { middleware: (req: Request, res: Response, next: NextFunction) => void } {
  const als = new AsyncLocalStorage<Holder>();
  const ssl = opts.ssl ? { rejectUnauthorized: false } : false;
  const get = (): Promise<pg.Client> => {
    const h = als.getStore();
    if (!h) throw new Error('Database used outside of a request');
    if (!h.client) {
      h.client = (async () => {
        const c = new pg.Client({ connectionString, ssl });
        await c.connect();
        return c;
      })();
    }
    return h.client;
  };
  const run: Queryable['query'] = async (sql, params) => {
    const r = await (await get()).query(sql, params as any[]);
    return { rows: r.rows, rowCount: r.rowCount ?? 0 };
  };
  return {
    query: run,
    async tx(fn) {
      // One client per request, so a nested tx() call joins the outer transaction.
      const h = als.getStore();
      if (!h) throw new Error('Database used outside of a request');
      if (h.txDepth > 0) return fn({ query: run });
      h.txDepth++;
      try {
        await run('begin');
        const out = await fn({ query: run });
        await run('commit');
        return out;
      } catch (e) {
        await run('rollback').catch(() => undefined);
        throw e;
      } finally {
        h.txDepth--;
      }
    },
    close: async () => undefined,
    middleware(_req, res, next) {
      const holder: Holder = { txDepth: 0 };
      let closed = false;
      const end = () => {
        if (closed || !holder.client) return;
        closed = true;
        holder.client.then((c) => c.end()).catch(() => undefined);
      };
      res.on('finish', end);
      res.on('close', end);
      als.run(holder, next);
    },
  };
}
