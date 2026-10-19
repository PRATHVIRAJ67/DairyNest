// One-command Cloudflare deployment: API on Workers (+ Hyperdrive to Supabase) and the web app as a static-assets Worker.
// Prerequisites: `npx wrangler login` once, and the repo-root .env filled in (DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY).
// Usage (repo root): npm run cf:deploy            -> API + web app
//                    npm run cf:deploy -- --api-only
// Safe to re-run: existing Hyperdrive config and Pages project are reused; secrets and code are updated.
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(apiDir, '..', '..');
const mobileDir = join(root, 'apps', 'mobile');
const apiOnly = process.argv.includes('--api-only');
const HD_NAME = 'dairynest-db';

const step = (m) => console.log(`\n▸ ${m}`);
const fail = (m) => { console.error(`\n✖ ${m}`); process.exit(1); };
const wr = (args, opts = {}) => {
  const r = spawnSync('npx', ['wrangler', ...args], { cwd: opts.cwd ?? apiDir, shell: true, encoding: 'utf8', input: opts.input, env: { ...process.env, ...opts.env } });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (opts.echo !== false) process.stdout.write(out.split('\n').filter((l) => !/password|postgres(ql)?:\/\//i.test(l)).join('\n'));
  return { ok: r.status === 0, out };
};

function readEnv(file) {
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

// ---------------------------------------------------------------- checks
const env = readEnv(join(root, '.env'));
for (const k of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
  if (!env[k] || /PASTE|YOUR-/.test(env[k])) fail(`${k} is missing in .env (repo root).`);
}
step('Checking Cloudflare login');
if (!wr(['whoami'], { echo: false }).out.match(/associated with the email|You are logged in/i)) fail('Not logged in. Run: npx wrangler login');

// ---------------------------------------------------------------- Hyperdrive (pooled, TLS connection to Supabase)
step(`Hyperdrive config "${HD_NAME}"`);
const sessionPooler = env.DATABASE_URL.replace(':6543/', ':5432/'); // Hyperdrive does its own pooling: use session mode
let hdId = (wr(['hyperdrive', 'list'], { echo: false }).out.split('\n').find((l) => l.includes(HD_NAME))?.match(/[0-9a-f]{32}/) ?? [])[0];
if (!hdId) {
  const r = wr(['hyperdrive', 'create', HD_NAME, `--connection-string="${sessionPooler}"`, '--caching-disabled'], { echo: false });
  hdId = (r.out.match(/"id":\s*"([0-9a-f]{32})"/) ?? r.out.match(/\b([0-9a-f]{32})\b/) ?? [])[1];
  if (!hdId) fail(`Could not create Hyperdrive:\n${r.out.replace(/postgres(ql)?:\/\/\S+/g, '[connection string]')}`);
  console.log(`  created ${hdId}`);
} else console.log(`  reusing ${hdId}`);

const cfgPath = join(apiDir, 'wrangler.jsonc');
let cfg = readFileSync(cfgPath, 'utf8');
if (!/^\s*"hyperdrive"\s*:/m.test(cfg)) { // ignore the commented example
  cfg = cfg.replace(/\n}\s*$/, `,\n  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "${hdId}" }]\n}\n`);
  writeFileSync(cfgPath, cfg);
  console.log('  added HYPERDRIVE binding to wrangler.jsonc');
}

// ---------------------------------------------------------------- API Worker
step('Deploying API Worker');
const testing = !!(env.TEST_LOGIN_CODE && env.TEST_SESSION_SECRET);
const vars = ['--var', `SUPABASE_URL:${env.SUPABASE_URL}`, '--var', `PAYMENTS_MODE:${env.PAYMENTS_MODE || 'razorpay'}`];
if (testing) console.log('  ⚠ TEST MODE: test login is ON and payments are ' + (env.PAYMENTS_MODE || 'razorpay') + '. Remove TEST_* from .env before launch.');
let dep = wr(['deploy', ...vars]);
if (!dep.ok) fail('Worker deploy failed.');
const apiUrl = (dep.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/) ?? [])[0];
if (!apiUrl) fail('Deployed, but could not read the workers.dev URL from the output.');
console.log(`  API: ${apiUrl}/api/v1`);

// ---------------------------------------------------------------- secrets
step('Uploading secrets (encrypted at Cloudflare, never stored in the repo)');
const secrets = { DATABASE_URL: env.DATABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY };
for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'EXPO_ACCESS_TOKEN', 'TEST_LOGIN_CODE', 'TEST_SESSION_SECRET']) {
  if (env[k]) secrets[k] = env[k];
}
const secretFile = join(tmpdir(), `dairynest-secrets-${process.pid}.json`);
writeFileSync(secretFile, JSON.stringify(secrets));
try {
  if (!wr(['secret', 'bulk', `"${secretFile}"`]).ok) fail('Uploading secrets failed (the Worker may need a first deploy; re-run this script).');
} finally {
  writeFileSync(secretFile, '{}');
}

const health = execSync(`curl -s --max-time 30 ${apiUrl}/api/v1/health`, { encoding: 'utf8' });
console.log(`  health: ${health}`);

// Point the "cloud" APK profile at the live API (publishable values only; they ship inside the app anyway).
const easPath = join(mobileDir, 'eas.json');
const eas = JSON.parse(readFileSync(easPath, 'utf8'));
eas.build.cloud = {
  distribution: 'internal',
  android: { buildType: 'apk' },
  env: { EXPO_PUBLIC_API_URL: `${apiUrl}/api/v1`, EXPO_PUBLIC_SUPABASE_URL: env.SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY, EXPO_PUBLIC_TEST_LOGIN: testing ? '1' : '0' },
};
writeFileSync(easPath, `${JSON.stringify(eas, null, 2)}\n`);
console.log('  updated the "cloud" APK profile in apps/mobile/eas.json');

if (apiOnly) {
  console.log(`\n✔ Done. API base URL for the app: ${apiUrl}/api/v1`);
  process.exit(0);
}

// ---------------------------------------------------------------- Web app (static assets on Workers)
step('Building the web app');
const publicEnv = {
  EXPO_PUBLIC_API_URL: `${apiUrl}/api/v1`,
  EXPO_PUBLIC_SUPABASE_URL: env.SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
  EXPO_PUBLIC_DEMO_MODE: '0',
  EXPO_PUBLIC_TEST_LOGIN: testing ? '1' : '0',
  CI: '1',
};
const b = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist-web'], { cwd: mobileDir, shell: true, stdio: 'inherit', env: { ...process.env, ...publicEnv } });
if (b.status !== 0) fail('Web build failed.');
step('Deploying the web app (static assets Worker "dairynest-web")');
const wd = wr(['deploy'], { cwd: mobileDir });
if (!wd.ok) fail('Web app deploy failed.');
const webUrl = (wd.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/) ?? [])[0];
if (!webUrl) fail('Web app deployed, but could not read its workers.dev URL.');

step('Allowing the web app to call the API (CORS)');
// Other browser apps that call the API (e.g. the partner dashboard) come from EXTRA_CORS_ORIGINS in .env.
const origins = [webUrl, 'http://localhost:8081', ...(env.EXTRA_CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)];
dep = wr(['deploy', ...vars, '--var', `CORS_ORIGINS:${origins.join(',')}`], { echo: false });
if (!dep.ok) fail('Re-deploy with CORS failed.');

console.log(`\n✔ Done.\n  Web app: ${webUrl}\n  API:     ${apiUrl}/api/v1\n  For the APK, use EXPO_PUBLIC_API_URL=${apiUrl}/api/v1`);
