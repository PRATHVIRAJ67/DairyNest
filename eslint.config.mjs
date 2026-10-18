import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-*/**', '**/.expo/**', '**/.wrangler/**', '**/node_modules/**', '**/.expo/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Rows coming back from raw SQL are untyped; keep this visible without blocking.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  { files: ['**/scripts/**/*.{js,mjs}', '**/workers-shims/**'], languageOptions: { globals: { ...globals.node } } },
  { files: ['**/tests/**', '**/*.test.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
