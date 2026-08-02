import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/generated/**',
      '**/dev-dist/**',
      '.claude/**',
      'scripts/design-research/out/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },

  // Browser surfaces.
  {
    files: ['apps/pos/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // Node surfaces: the API, and every config file that runs in Node.
  {
    files: [
      'apps/api/**/*.{ts,mts,mjs}',
      'scripts/**/*.{ts,mts,mjs}',
      '**/*.config.{ts,mts,mjs}',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // NestJS resolves constructor dependencies from the `design:paramtypes`
  // metadata TypeScript emits, which requires a VALUE import. `import type`
  // erases the class and injection fails at runtime with a confusing
  // "Nest can't resolve dependencies" error. The rule is actively harmful here.
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);
