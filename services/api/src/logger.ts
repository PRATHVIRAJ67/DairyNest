import pino from 'pino';

export function createLogger(level = 'info') {
  return pino({
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers["x-razorpay-signature"]', '*.password', '*.token'],
      censor: '[redacted]',
    },
  });
}
export type Logger = ReturnType<typeof createLogger>;
