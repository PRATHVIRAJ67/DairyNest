import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import type { Deps } from './deps';
import { errorHandler, notFoundHandler, requestId } from './http';
import { buildOpenApi } from './openapi';
import { buildRouter } from './routes';

export interface AppOptions {
  rateLimit?: boolean;
  /** Interactive Swagger UI (reads static files from disk, so it is off on Cloudflare Workers). */
  docs?: boolean;
  /** Runs first on every request, e.g. to open a per-request database connection on Workers. */
  requestScope?: express.RequestHandler;
}

export function createApp(deps: Deps, opts: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (deps.config.NODE_ENV === 'production') app.set('trust proxy', 1);

  if (opts.requestScope) app.use(opts.requestScope);
  app.use(requestId());
  app.use(pinoHttp({ logger: deps.log, genReqId: (req) => (req as any).requestId, autoLogging: deps.config.NODE_ENV !== 'test' }));
  app.use(helmet({ contentSecurityPolicy: false }));
  const origins = deps.config.CORS_ORIGINS === '*' ? true : deps.config.CORS_ORIGINS.split(',').map((s) => s.trim());
  app.use(cors({ origin: origins }));

  if (opts.rateLimit !== false) {
    const json = (message: string) => ({ error: { code: 'RATE_LIMITED', message } });
    app.use('/api/v1', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: json('Too many requests. Please slow down.'),
      skip: (req) => req.path.startsWith('/webhooks') }));
    app.use('/api/v1/payments', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: json('Too many payment requests.') }));
  }

  // Keep the raw bytes: webhook signatures are computed over the exact body Razorpay sent.
  app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

  const spec = buildOpenApi();
  app.get('/api/v1/openapi.json', (_req, res) => res.json(spec));
  if (opts.docs !== false) app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(spec));
  else app.get('/api/v1/docs', (_req, res) => res.redirect('/api/v1/openapi.json'));

  app.use('/api/v1', buildRouter(deps));
  app.use(notFoundHandler());
  app.use(errorHandler(deps.log));
  return app;
}
