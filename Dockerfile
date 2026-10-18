# API image (services/api). Build from the repo root:  docker build -t dailydairy-api .
# Real mode (default): needs DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY (+ optional Razorpay vars).
# Demo mode: set START_MODE=demo (in-memory data, simulated login/payments; never for real customers).
FROM node:22-slim
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Install only the API workspace (and the shared packages it links), not the mobile app.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/validation/package.json packages/validation/
COPY services/api/package.json services/api/
# The lockfile covers every workspace, so their manifests must exist for `npm ci` (their deps are not installed).
COPY apps/mobile/package.json apps/mobile/
COPY supabase/package.json supabase/
RUN npm ci --workspace=@milk/api --include-workspace-root --ignore-scripts

COPY packages ./packages
COPY services/api ./services/api
COPY supabase ./supabase
RUN npm run build -w @milk/api

ENV PORT=10000
EXPOSE 10000
CMD ["sh", "-c", "if [ \"$START_MODE\" = demo ]; then cd services/api && npx tsx scripts/local-demo.ts; else node services/api/dist/server.js; fi"]
