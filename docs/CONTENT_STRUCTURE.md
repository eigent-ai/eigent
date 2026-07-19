# Eigent Documentation Structure

This file is the editorial map for the public Mintlify documentation. Navigation is defined in `docs/docs.json`. Writing and media conventions are defined in `docs/STYLE_GUIDE.md`.

## Information Architecture

### Get Started

- Welcome and product positioning
- Installation
- Quick start
- Self-hosting
- Core concepts

### Dashboard

- Dashboard overview
- Spaces
- Projects
- Tasks
- Search, sort, grid, list, and board views

### Projects

- Space, Project, Session, and Run hierarchy
- Project creation
- Workspace landing
- Context and files
- Live sessions
- Multi-run follow-ups
- Single Agent mode
- Workforce mode

### Agents

- Agent capabilities
- Workers
- Agent Skills
- Remote sub-agents
- Memory roadmap

### Models

- Model selection overview
- Eigent Cloud
- Bring Your Own Key
- Local models
- Provider reference
- Provider-specific setup guides

### Connectors

- Connector overview
- MCP marketplace
- Custom local and remote MCP servers
- Google Search
- Tool assignment

### Browser

- Browser automation overview
- CDP browser connections
- Browser cookie management
- Browser Plugins roadmap

### Automation

- Automation overview
- Scheduled triggers
- Webhook and Slack triggers
- Dispatch and remote control
- Execution logs and retries

### Settings

- Account, language, proxy, and updates
- Appearance and custom themes
- Privacy and data handling

### Open Source

- Repository and contribution overview
- Self-hosting
- Brain architecture

## Provider Coverage

The provider reference must remain synchronized with `src/lib/llm.ts` and `src/pages/Agents/localModels.ts`.

Cloud and BYOK coverage:

- Gemini
- OpenAI
- Anthropic
- OrcaRouter
- OpenRouter
- Qwen
- DeepSeek
- MiniMax
- Z.ai
- Moonshot
- ModelArk
- SambaNova
- Grok
- Mistral
- AWS Bedrock
- AWS Bedrock Converse
- Azure
- ERNIE
- OpenAI-compatible endpoints

Local runtime coverage:

- Ollama
- vLLM
- SGLang
- LM Studio
- LLaMA.cpp

## Editorial Priorities

1. Capture current screenshots for Dashboard, Workspace, Context, Models, Connectors, Browser, and Triggers.
2. Replace outline language with task-focused procedures.
3. Add provider credential and endpoint examples.
4. Add self-hosting commands and environment configuration.
5. Add troubleshooting links from every setup guide.
6. Mark coming-soon features clearly and remove those labels only when shipped.

## Maintenance Checks

- Every route in `docs/docs.json` must resolve to a Markdown file.
- Every page must include `title` and `description` frontmatter.
- Feature names should match current UI labels.
- Model providers should be audited whenever `src/lib/llm.ts` changes.
- Local runtimes should be audited whenever `src/pages/Agents/localModels.ts` changes.
- Coming-soon features must not be described as generally available.
