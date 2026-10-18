// Cloudflare Workers stand-in for swagger-ui-express (aliased in wrangler.jsonc). The docs UI reads static files
// from disk, which Workers cannot do; the Worker serves /api/v1/openapi.json instead (createApp docs: false).
const passthrough = (_req, _res, next) => next();
export default { serve: [passthrough], setup: () => passthrough };
