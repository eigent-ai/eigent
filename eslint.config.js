import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  // Globally ignored files and directories
  {
    ignores: [
      // Dependencies
      'node_modules/**',
      'package/@stackframe/**',
      // Build outputs
      'dist/**',
      'dist-electron/**',
      'build/**',
      // Cache
      '.cache/**',
      '.vite/**',
      // Config files
      'vite.config.ts',
      'vitest.config.ts',
      'tailwind.config.js',
      'postcss.config.cjs',
      // Generated files
      '**/*.d.ts',
      '**/*.map',
      // Python files
      '**/*.py',
      '__pycache__/**',
      '**/.venv/**',
    ],
  },
  // Configuration for JavaScript and TypeScript files
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: typescriptParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      '@typescript-eslint': typescript,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // React rules
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      // React Hooks rules
      ...reactHooks.configs.recommended.rules,
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  // Prettier config (must be last to override conflicting rules)
  prettier,
];
