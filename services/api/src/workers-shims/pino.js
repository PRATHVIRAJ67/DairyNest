// Cloudflare Workers stand-in for pino (aliased in wrangler.jsonc). Same call shapes, JSON lines via console.
// Never logs request headers, so tokens and signatures cannot leak.
const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: Infinity };

function serialize(v) {
  if (v instanceof Error) return { type: v.name, message: v.message, stack: v.stack, code: v.code };
  return v;
}

function make(level, bindings) {
  const min = LEVELS[level] ?? 30;
  const logger = { level, bindings: () => bindings };
  for (const [name, n] of Object.entries(LEVELS)) {
    if (name === 'silent') continue;
    logger[name] = (a, b) => {
      if (n < min) return;
      const obj = a && typeof a === 'object' ? a : {};
      const msg = typeof a === 'string' ? a : b;
      const out = { level: n, time: Date.now(), ...bindings };
      for (const [k, v] of Object.entries(obj)) out[k] = serialize(v);
      if (msg) out.msg = msg;
      (n >= 50 ? console.error : n >= 40 ? console.warn : console.log)(JSON.stringify(out));
    };
  }
  logger.child = (extra) => make(level, { ...bindings, ...extra });
  logger.isLevelEnabled = (l) => (LEVELS[l] ?? 0) >= min;
  return logger;
}

export default function pino(opts = {}) {
  return make(opts.level ?? 'info', {});
}
