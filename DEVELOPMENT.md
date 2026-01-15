# Development Environment Setup Guide

This guide will help you set up your local development environment, including code formatting, code linting, and Git hooks configuration.

## 📋 Table of Contents

- [Tool Introduction](#tool-introduction)
- [Quick Start](#quick-start)
- [VS Code Configuration](#vs-code-configuration)
- [Common Commands](#common-commands)
- [Git Hooks](#git-hooks)
- [Troubleshooting](#troubleshooting)

## 🛠️ Tool Introduction

This project uses the following tools to ensure code quality and consistency:

### Prettier

- **Purpose**: Code formatting tool
- **Config File**: `.prettierrc.json`
- **Ignore File**: `.prettierignore`
- **Features**: Automatically formats TypeScript, JavaScript, JSON, CSS, Markdown, and other files

### ESLint

- **Purpose**: Code quality checking tool
- **Config File**: `eslint.config.js` (ESLint v9 flat config format)
- **Features**: Checks for code errors, potential issues, and automatically fixes some problems
- **Note**: ESLint v9 uses a new flat config format, with ignore rules defined directly in the config file

### Husky + lint-staged

- **Purpose**: Git hooks management, automatically runs checks and formatting before committing code
- **Config Files**: `.husky/pre-commit`, `.lintstagedrc.json`
- **Features**: Ensures all code committed to the repository is formatted and checked

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

This will automatically install all necessary dependencies, including Prettier, ESLint, Husky, and lint-staged.

### 2. Configure Git Hooks (First-time Setup)

If you're cloning the repository for the first time, you need to configure the Git hooks path:

```bash
git config core.hooksPath .husky
```

> **Note**: This command only needs to be run once. If the project is already configured, you can skip this step.

### 3. Verify Configuration

Run the following commands to verify that the configuration is correct:

```bash
# Check code formatting
npm run format:check

# Check code quality
npm run lint
```

## 💻 VS Code Configuration

For the best development experience, we recommend installing the following VS Code extensions:

### Required Extensions

The project has configured recommended extensions (`.vscode/extensions.json`), and VS Code will automatically prompt you to install them:

- **Prettier - Code formatter** (`esbenp.prettier-vscode`)
- **ESLint** (`dbaeumer.vscode-eslint`)
- **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`)

### Automatic Configuration

The project's `.vscode/settings.json` has configured the following features:

- ✅ Auto-format on save
- ✅ Auto-fix ESLint errors on save
- ✅ Auto-organize imports on save
- ✅ Prettier as the default formatter

**No manual configuration needed** - these settings will automatically take effect when you open the project.

### Manual Configuration (Optional)

If you're using a different editor or want to customize settings, you can refer to the configuration in `.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit",
    "source.organizeImports": "explicit"
  }
}
```

## 📝 Common Commands

### Code Linting

```bash
# Check all files for ESLint issues
npm run lint

# Automatically fix ESLint issues
npm run lint:fix
```

### Code Formatting

```bash
# Format all files
npm run format

# Only check formatting without modifying files
npm run format:check
```

### Type Checking

```bash
# TypeScript type checking
npm run type-check
```

## 🔒 Git Hooks

### Pre-commit Hook

When you execute `git commit`, the following process will be automatically triggered:

1. **lint-staged** checks staged files (`.ts`, `.tsx`, `.js`, `.jsx`)
2. Automatically runs **ESLint** fixes
3. Automatically runs **Prettier** formatting
4. If there are errors that cannot be automatically fixed, the commit will be blocked

### Workflow Example

```bash
# 1. Modify code
git add src/components/MyComponent.tsx

# 2. Commit code (checks and formatting will run automatically)
git commit -m "feat: add new component"

# If there are code issues, you'll see output like:
# ✖ lint-staged failed
# ✖ ESLint found errors
#
# After fixing errors, re-add and commit
git add src/components/MyComponent.tsx
git commit -m "feat: add new component"
```

### Skipping Hooks (Not Recommended)

If you really need to skip hooks (e.g., for urgent fixes), you can use:

```bash
git commit --no-verify -m "urgent fix"
```

> **⚠️ Warning**: Hooks should only be skipped in special circumstances. Under normal circumstances, you should fix all issues before committing.

## ❓ Troubleshooting

### Q1: "lint-staged command not found" when committing

**Solution**:

```bash
npm install
```

Ensure `lint-staged` is properly installed.

### Q2: Pre-commit hook is not running

**Check Steps**:

1. Confirm Git hooks path is configured:

   ```bash
   git config core.hooksPath
   # Should output: .husky
   ```

2. If there's no output or incorrect output, run:

   ```bash
   git config core.hooksPath .husky
   ```

3. Confirm `.husky/pre-commit` file has execute permissions:
   ```bash
   ls -la .husky/pre-commit
   # Should see -rwxr-xr-x or similar permissions
   ```

### Q3: VS Code is not auto-formatting

**Solution**:

1. Confirm Prettier extension is installed
2. Check if `editor.formatOnSave` is set to `true` in VS Code settings
3. Restart VS Code
4. Check if the file is in `.prettierignore`

### Q4: ESLint and Prettier conflicts

The project has configured `eslint-config-prettier` to avoid conflicts. If you still have issues:

1. Ensure all dependencies are installed:

   ```bash
   npm install
   ```

2. Check that `prettier` configuration is at the end of the array in `eslint.config.js` (must be loaded last)

### Q5: How to format only specific files?

```bash
# Format a single file
npx prettier --write src/components/MyComponent.tsx

# Format an entire directory
npx prettier --write src/components/
```

### Q6: How to temporarily disable ESLint checking for a file?

Add at the top of the file:

```typescript
/* eslint-disable */
// Or for specific rules
/* eslint-disable @typescript-eslint/no-explicit-any */
```

### Q7: Formatting is slow when committing

lint-staged only processes staged files, which is usually fast. If it's slow, it might be because:

1. Too many files staged - consider committing in batches
2. Files are very large - consider splitting files

### Q8: ESLint can't find config file

If you see "ESLint couldn't find an eslint.config.(js|mjs|cjs) file" error:

1. Confirm `eslint.config.js` file exists in the project root
2. Confirm you're using ESLint v9 (project is configured for this)
3. If you've used an older version of ESLint before, you may need to clear the cache:
   ```bash
   rm -rf node_modules/.cache
   npm install
   ```

### Q9: ESLint v9 configuration format issues

The project has migrated to ESLint v9's flat config format. If you encounter configuration-related errors:

1. Ensure all necessary dependencies are installed:

   ```bash
   npm install globals @eslint/js
   ```

2. Check that `eslint.config.js` file syntax is correct
3. If problems persist, check the [ESLint Migration Guide](https://eslint.org/docs/latest/use/configure/migration-guide)

## 📚 Configuration Files

### `.prettierrc.json`

Prettier formatting rules configuration, including:

- Single quotes
- ES5 trailing commas
- Tailwind CSS class sorting
- Auto-organize imports

### `eslint.config.js`

ESLint checking rules configuration (ESLint v9 flat config format), including:

- React and React Hooks rules
- TypeScript rules
- Prettier integration
- File ignore rules (defined directly in the config file)

### `.lintstagedrc.json`

lint-staged configuration, defining which file types need to run which commands.

### `.prettierignore`

Specifies which files or directories should not be formatted by Prettier.

**Note**: ESLint v9 no longer uses `.eslintignore` files. Ignore rules are defined directly in the `ignores` array in `eslint.config.js`.

## 🤝 Contributing Guidelines

Before submitting code, please ensure:

1. ✅ Code passes ESLint checks: `npm run lint`
2. ✅ Code is formatted: `npm run format`
3. ✅ TypeScript type checking passes: `npm run type-check`
4. ✅ All tests pass: `npm test`

## 📞 Getting Help

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section of this document
2. Check the project's GitHub Issues
3. Contact the team lead

---

**Last Updated**: 2024
