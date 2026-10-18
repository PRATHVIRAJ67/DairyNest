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
