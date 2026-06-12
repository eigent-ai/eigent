---
title: Agents overview
description: Configure the models, Skills, sub-agents, tools, and workers that execute Eigent tasks.
icon: bot
---

Agents perform the work requested in an Eigent Project. Their behavior depends on the selected model, assigned tools, Skills, project context, and execution mode.

Use the Agents dashboard to configure reusable capabilities before starting a task.

## Open the Agents dashboard

1. Open the Eigent dashboard.
2. Select **Agents**.
3. Choose **Models**, **Skills**, **Sub-agents**, or **Memory**.

> **Screenshot placeholder:** Add a screenshot of the Agents dashboard with the four navigation items visible. Use a configured model and example Skills, but hide all API keys.

## Configure models

Models provide reasoning and generation capabilities.

Eigent supports:

- Eigent Cloud models
- Cloud providers using your own API keys
- OpenAI-compatible endpoints
- Local inference runtimes

Configure at least one valid model before starting a task. See [Models overview](/models/overview).

## Add Agent Skills

Skills are reusable packages that provide instructions, scripts, templates, and domain knowledge. Eigent loads relevant Skills when a task matches their description.

Use Skills for repeatable workflows such as:

- Writing a specific report format
- Following an engineering process
- Creating branded presentations
- Operating a specialized tool
- Applying organization-specific rules

See [Agent Skills](/core/agent-skills).

## Configure workers

Workers are specialized roles used by Workforce mode. A worker combines:

- Name and role description
- One or more tools
- Model access
- Instructions and Skills

Eigent includes built-in Developer, Browser, Document, and Multimodal workers. Add custom workers when a task needs a recurring role or connector.

## Connect remote sub-agents

Remote sub-agents let Eigent delegate work to an externally hosted agent. The current interface supports a Gemini remote sub-agent configuration.

Use a remote sub-agent when the external system has capabilities or context that should remain outside the local Eigent runtime.

## Agent Memory status

The Memory page is currently marked **Coming soon**. Project conversation history, instructions, files, and Skills are available today, but the separate persistent Agent Memory configuration is not generally available.

## Recommended setup order

1. Configure and validate a model.
2. Install required connectors or MCP servers.
3. Add Skills for reusable workflows.
4. Create or edit Workforce workers.
5. Optional: Configure a remote sub-agent.
6. Start a test Project with a small task.

> **Video placeholder:** Add a 90-second MP4 showing a model setup, Skill upload, custom worker creation, and a successful Workforce task. Include captions and a transcript.

## Security

- Use least-privilege credentials for models and tools.
- Audit untrusted Skills before enabling them.
- Review MCP commands and remote URLs.
- Limit local-folder Spaces to directories the agents should access.
- Remove unused provider keys, cookies, and connector credentials.

## Related guides

<CardGroup>
  <Card title="Workers" icon="bot" href="/core/workers">
    Create specialized Workforce roles and assign tools.
  </Card>
  <Card title="Agent Skills" icon="sparkles" href="/core/agent-skills">
    Add reusable instructions, scripts, and resources.
  </Card>
  <Card title="Models overview" icon="brain" href="/models/overview">
    Choose managed, BYOK, or local models.
  </Card>
</CardGroup>
