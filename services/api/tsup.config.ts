import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  noExternal: ['@milk/shared', '@milk/validation'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
