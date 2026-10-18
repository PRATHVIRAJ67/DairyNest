import pino from 'pino';

export function createLogger(level = 'info', opts: { console?: boolean } = {}) {
  // On Cloudflare Workers there is no stdout stream; pino writes each JSON line through console.log instead.
  const dest = opts.console ? { write: (line: string) => console.log(line.trimEnd()) } : undefined;
  return pino({
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers["x-razorpay-signature"]', '*.password', '*.token'],
      censor: '[redacted]',
    },
  }, dest as any);
}
export type Logger = ReturnType<typeof createLogger>;
