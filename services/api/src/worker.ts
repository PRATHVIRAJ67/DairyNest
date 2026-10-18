/**
 * Cloudflare Workers entry. Runs the same Express app through Workers' node:http server support.
 * Configuration comes from wrangler vars and secrets (exposed on process.env by nodejs_compat).
 * If a Hyperdrive binding named HYPERDRIVE exists, it is used for pooled database connections.
 *
 * The app is built on the first request, not at startup: Workers forbid timers and I/O in global scope,
 * and the rate limiter starts a cleanup timer when it is created.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { createApp } from './app';
import { buildDeps } from './bootstrap';
import { loadConfig } from './config';
import { createRequestScopedPgDb } from './db';
import { createLogger } from './logger';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let app: Handler | undefined;

function build(): Handler {
  const bindings = env as unknown as Record<string, unknown> & { HYPERDRIVE?: { connectionString: string } };
  const config = loadConfig({ ...process.env, NODE_ENV: 'production', PORT: '8787' } as NodeJS.ProcessEnv);
  const log = createLogger(config.LOG_LEVEL, { console: true });
  // Hyperdrive (production): the Worker talks to Hyperdrive inside Cloudflare and Hyperdrive uses TLS to Supabase.
  // Without it, connect with TLS. DATABASE_SSL=false is only for `wrangler dev` (local runtime TLS limitation).
  const hyperdrive = bindings.HYPERDRIVE?.connectionString;
  const localNoTls = process.env.DATABASE_SSL === 'false' && process.env.WRANGLER_LOCAL_DEV === '1';
  const db = createRequestScopedPgDb(hyperdrive ?? config.DATABASE_URL, { ssl: !hyperdrive && !localNoTls });
  return createApp(buildDeps(config, log, db), { docs: false, requestScope: db.middleware }) as unknown as Handler;
}

const server = createServer((req, res) => {
  try {
    app ??= build();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'SERVER_MISCONFIGURED', message: 'The server is not configured correctly.' } }));
    return;
  }
  app(req, res);
});
server.listen(8787);
export default httpServerHandler({ port: 8787 });
