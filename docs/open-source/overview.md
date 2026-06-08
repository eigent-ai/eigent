---
title: Open-source Eigent
description: Build, inspect, extend, and self-host Eigent from its public source code.
icon: code-branch
---

Eigent is an open-source agent workspace built around model choice, extensible tools, and local control. You can inspect the implementation, run the application yourself, connect private infrastructure, and contribute changes.

## Why open source matters

Open source lets teams:

- Choose managed, BYOK, or local models
- Inspect agent and tool assembly
- Connect local files and browsers
- Add MCP servers and custom integrations
- Modify the React and Electron application
- Extend the Python Brain and server APIs
- Operate with their own security controls

## Repository structure

The repository contains several major areas:

| Area             | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| `src/`           | React application, stores, pages, and components              |
| `electron/`      | Desktop host, IPC, windows, and local integrations            |
| `backend/`       | Brain backend, agents, tools, memory, and workspace services  |
| `server/`        | Server APIs, domains, persistence, remote control, and Spaces |
| `test/`          | Frontend and Electron tests                                   |
| `backend/tests/` | Brain backend tests                                           |
| `server/tests/`  | Server tests                                                  |
| `docs/`          | Mintlify product documentation                                |

> **Screenshot placeholder:** Add a repository tree diagram or screenshot that highlights the major directories without exposing local paths or unrelated files.

## Set up a development environment

1. Clone the repository.
2. Install the required Node.js and Python versions.
3. Install dependencies.
4. Review development environment files.
5. Start the application.
6. Configure a test model.

See [Self-hosting](/get_started/self-hosting) for the setup workflow.

## Run quality checks

Common frontend checks include:

```bash
npm run type-check
npm run lint
npm test
npm run format:check
```

Run focused backend and server tests for the modules you change.

## Extend Eigent

Common extension points include:

- Add a model provider.
- Add a local inference runtime.
- Add an MCP integration.
- Create an Agent Skill.
- Add or modify a worker.
- Add a trigger type.
- Add a dashboard or Workspace surface.
- Extend Space, Project, or remote-control APIs.

Follow existing module boundaries and add tests for shared behavior.

## Contribute changes

A useful contribution should include:

- A clear problem statement
- Focused implementation
- Tests proportional to risk
- Documentation for user-facing behavior
- Screenshots or recordings for UI changes
- Migration notes for schema or configuration changes

Before opening a pull request:

1. Review the repository contribution guidance.
2. Rebase or update from the target branch.
3. Run relevant checks.
4. Remove secrets and local-only files.
5. Describe verification steps.

> **Video placeholder:** Add a 90-second contributor onboarding MP4 showing repository setup, a small UI or documentation change, tests, and a pull request. Include captions.

## Documentation contributions

Product documentation lives in `docs/`.

- Add pages to `docs/docs.json`.
- Include `title` and `description` frontmatter.
- Use task-based procedures.
- Add visible screenshot and video placeholders when assets are not ready.
- Keep provider docs synchronized with model configuration source files.
- Mark coming-soon functionality clearly.

## Community and support

Use GitHub issues for reproducible bugs and feature requests. Include:

- Eigent version
- Operating system
- Deployment mode
- Model provider or local runtime
- Reproduction steps
- Expected and actual behavior
- Sanitized logs

## Related guides

<CardGroup>
  <Card title="Brain architecture" icon="diagram-project" href="/core/brain-architecture">
    Understand the main runtime and service boundaries.
  </Card>
  <Card title="Self-hosting" icon="server" href="/get_started/self-hosting">
    Run Eigent with your own infrastructure.
  </Card>
  <Card title="Custom MCP servers" icon="wrench" href="/connectors/custom-mcp">
    Extend agents with new tools.
  </Card>
</CardGroup>
