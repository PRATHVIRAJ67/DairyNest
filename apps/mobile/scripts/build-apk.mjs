// Builds an installable APK in Expo's cloud (EAS Build). Requires `npx eas-cli login` once.
// Usage: npm run apk:demo   (profile "demo": separate "DailyDairy Demo" app pointed at the local demo API)
// The repo is uploaded without git (EAS_NO_VCS) so it works before the first commit; .easignore keeps
// secrets, node_modules and build output out of the upload.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const profile = process.argv[2] ?? 'demo';
const here = dirname(fileURLToPath(import.meta.url));
const r = spawnSync('npx', ['--yes', 'eas-cli@latest', 'build', '--platform', 'android', '--profile', profile, '--non-interactive', '--no-wait'], {
  cwd: resolve(here, '..'),
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, EAS_NO_VCS: '1', EAS_PROJECT_ROOT: resolve(here, '..', '..', '..') },
});
process.exit(r.status ?? 1);
