import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import security from 'eslint-plugin-security';
import nounsanitized from 'eslint-plugin-no-unsanitized';
import globals from 'globals';
import { includeIgnoreFile } from '@eslint/compat';
import { fileURLToPath } from 'node:url';
import svelteConfig from './svelte.config.mjs';

const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url));

export default tseslint.config(
  // Respect .gitignore patterns
  includeIgnoreFile(gitignorePath),

  // Base configs
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...svelte.configs['flat/recommended'],

  // Additional ignores not covered by .gitignore
  {
    ignores: ['*.config.*', 'shared/**/*.js'],
  },

  // Enable type-aware linting with explicit tsconfig paths
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
  },

  // Disable type-checked rules for config files (safety net)
  {
    files: ['**/*.config.*'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Svelte files: use TypeScript parser for script blocks
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        svelteConfig,
      },
    },
    rules: {
      // Crashes on Svelte AST nodes - incompatible with svelte parser
      'no-unexpected-multiline': 'off',
    },
  },

  // Browser globals for renderer (src/renderer/)
  {
    files: ['src/renderer/**/*.{ts,svelte}'],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // Node globals for main process and preload
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Shared files get both
  {
    files: ['shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // TypeScript rule overrides and relaxations
  {
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-empty-function': 'warn',
    },
  },

  // Core ESLint rules for security & reliability
  {
    rules: {
      // Security
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      // Reliability
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-throw-literal': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'warn',
      'no-constant-binary-expression': 'error',
    },
  },

  // Svelte strict rules
  {
    files: ['**/*.svelte'],
    rules: {
      'svelte/no-at-html-tags': 'error',
      'svelte/no-target-blank': 'error',
      'svelte/require-each-key': 'error',
      'svelte/valid-each-key': 'error',
      'svelte/no-dom-manipulating': 'warn',
    },
  },

  // Security plugin for Node.js main process
  {
    files: ['src/main/**/*.ts'],
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
    },
  },

  // XSS protection for renderer code
  {
    files: ['src/renderer/**/*.{ts,svelte}'],
    plugins: nounsanitized.configs.recommended.plugins,
    rules: {
      ...nounsanitized.configs.recommended.rules,
    },
  },
);
