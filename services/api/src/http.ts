import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError } from './errors';
import type { Logger } from './logger';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const ok = (res: Response, data: unknown, meta?: Record<string, unknown>, status = 200) =>
  res.status(status).json(meta ? { data, meta } : { data });

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.headers['x-request-id'];
    req.requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  };
}

/** Parse + replace req[part] with the validated value; returns 400 with field details on failure. */
export function validate<S extends ZodTypeAny>(schema: S, part: 'body' | 'query' | 'params' = 'body'): RequestHandler {
  return (req, _res, next) => {
    const r = schema.safeParse(req[part]);
    if (!r.success) return next(r.error);
    (req as any)[part] = r.data;
    next();
  };
}
export const body = <T>(req: Request) => req.body as T;
export const query = <S extends ZodTypeAny>(req: Request) => req.query as unknown as z.infer<S>;

export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

export function errorHandler(log: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';
    let details: unknown;
    if (err instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Some fields are invalid';
      details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    } else if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if ((err as any)?.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Request body is not valid JSON';
    } else if ((err as any)?.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request body too large';
    } else if ((err as any)?.code === '23505') {
      status = 409;
      code = 'CONFLICT';
      message = 'This record already exists';
    } else if (['23514', '23503', '22P02', '22007', '22008'].includes((err as any)?.code)) {
      status = 400;
      code = 'INVALID_DATA';
      message = 'The data provided is not valid';
    }
    if (status >= 500) log.error({ err, requestId: req.requestId }, 'unhandled error');
    res.status(status).json({ error: { code, message, details, requestId: req.requestId } });
  };
}
