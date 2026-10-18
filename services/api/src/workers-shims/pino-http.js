// Cloudflare Workers stand-in for pino-http (aliased in wrangler.jsonc): one line per request, no headers or bodies.
export default function pinoHttp(opts = {}) {
  const logger = opts.logger;
  return (req, res, next) => {
    const id = opts.genReqId ? opts.genReqId(req) : undefined;
    req.log = logger.child({ reqId: id });
    const start = Date.now();
    if (opts.autoLogging !== false) {
      res.on('finish', () => {
        const status = res.statusCode;
        const line = { reqId: id, method: req.method, url: req.originalUrl?.split('?')[0], status, ms: Date.now() - start };
        (status >= 500 ? logger.error : logger.info).call(logger, line, 'request completed');
      });
    }
    next();
  };
}
