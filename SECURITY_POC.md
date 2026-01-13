# Security Proof of Concept

This PR demonstrates a vulnerability in the CI workflow.

## Issue

The `ci.yml` workflow uses `pull_request_target` which grants write
permissions and secrets access, then checks out untrusted PR code and
executes it via `npx markdownlint-cli`.

## Attack Vector

The `.markdownlintrc.js` config file in this PR is executed when
markdownlint runs, allowing arbitrary code execution with access to:

- `GITHUB_TOKEN` with write permissions
- Repository secrets
- Ability to push code, create releases, etc.

## Remediation

1. Use `pull_request` instead of `pull_request_target`
2. Or don't checkout PR code when using `pull_request_target`
3. Or use a separate workflow with limited permissions for linting
