import { config } from './config';
import { authClient } from './authClient';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[];
interface Envelope<T> { data: T; meta?: { page?: number; pageSize?: number; total?: number; unread?: number } }

async function token(): Promise<string | null> {
  const { data } = await authClient().getSession();
  return data.session?.access_token ?? null;
}

async function raw(method: string, path: string, body?: Json, auth = true): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const t = await token();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  try {
    return await fetch(`${config.apiUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }
}

async function parse<T>(res: Response): Promise<Envelope<T>> {
  if (res.status === 204) return { data: undefined as T };
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Something went wrong. Please try again.', e?.details);
  }
  return json as Envelope<T>;
}

export async function call<T>(method: string, path: string, body?: Json, auth = true): Promise<Envelope<T>> {
  return parse<T>(await raw(method, path, body, auth));
}
export const api = {
  get: <T>(p: string) => call<T>('GET', p).then((r) => r.data),
  getPage: <T>(p: string) => call<T[]>('GET', p),
  post: <T>(p: string, b: Json = {}) => call<T>('POST', p, b).then((r) => r.data),
  put: <T>(p: string, b: Json) => call<T>('PUT', p, b).then((r) => r.data),
  patch: <T>(p: string, b: Json) => call<T>('PATCH', p, b).then((r) => r.data),
  del: (p: string) => call<void>('DELETE', p).then(() => undefined),
  publicGet: <T>(p: string) => call<T>('GET', p, undefined, false).then((r) => r.data),
  /** Fetches a text document (receipt) with the user's token. */
  async text(path: string): Promise<string> {
    const res = await raw('GET', path);
    if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'Could not download the document.');
    return res.text();
  },
};

/** Maps any thrown value to a customer-friendly message. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'VALIDATION_ERROR' && Array.isArray(e.details) && e.details[0]) return `${e.details[0].message}`;
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}
