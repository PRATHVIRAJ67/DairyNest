import { createApp } from './app';
import { buildDeps } from './bootstrap';
import { loadConfig } from './config';
import { createPgDb } from './db';
import { createLogger } from './logger';

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL);
const deps = buildDeps(config, log, createPgDb(config.DATABASE_URL));

const app = createApp(deps);
const server = app.listen(config.PORT, '0.0.0.0', () => log.info(`API listening on :${config.PORT} (docs at /api/v1/docs)`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log.info(`${sig} received, shutting down`);
    server.close(() => void deps.db.close().finally(() => process.exit(0)));
  });
}
