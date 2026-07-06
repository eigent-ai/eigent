---
title: Self-hosting
description: Run Eigent with your own backend, model providers, and local workspace.
icon: server
---

Self-host Eigent when you need control over model providers, credentials, project files, or the infrastructure that runs your agents. A self-hosted installation uses the open-source Eigent application and lets you connect cloud APIs, OpenAI-compatible endpoints, or local inference servers.

This page describes the recommended setup path. Exact deployment requirements can change between releases, so use the repository files and release notes as the source of truth for version-specific values.

## Before you begin

Prepare the following:

- A supported desktop operating system or Linux development environment
- Git
- Node.js `18` through `22`
- The Python version required by the repository backend
- Enough disk space for dependencies, generated files, and optional local models
- Credentials for at least one cloud provider, or a running local model server

<Note>
Local model requirements depend on the model and runtime. Large models can require substantial memory or GPU capacity.
</Note>

## Choose a deployment model

Eigent supports three common arrangements:

| Arrangement           | Model execution                               | Best for                                         |
| --------------------- | --------------------------------------------- | ------------------------------------------------ |
| Managed application   | Eigent Cloud                                  | Fast evaluation with minimal setup               |
| Self-hosted with BYOK | External provider APIs                        | Infrastructure control with hosted model quality |
| Fully local           | Ollama, vLLM, SGLang, LM Studio, or LLaMA.cpp | Private environments and local experimentation   |

You can configure more than one provider and change the preferred model later.

## Set up the repository

1. Clone the Eigent repository:

   ```bash
   git clone https://github.com/eigent-ai/eigent.git
   cd eigent
   ```

2. Install the frontend dependencies:

   ```bash
   npm install
   ```

3. Review `.env.development`, `backend/README.md`, and the root `README.md` for the current backend and environment configuration.

4. Start the development application:

   ```bash
   npm run dev
   ```

5. In Eigent, open **Agents > Models** and configure a model provider.

<Note>
The first development start can take longer because Eigent prepares frontend and backend dependencies.
</Note>

> **Screenshot placeholder:** Add a screenshot of Eigent running locally with **Agents > Models** open. Crop the image to the application window and hide credentials.

## Configure a model

For the fastest self-hosted setup, connect an existing provider:

1. In Eigent, open **Agents > Models**.
2. Expand **Bring Your Own Key**.
3. Select a provider.
4. Enter the API key, endpoint, and model name required by that provider.
5. Select **Validate** or **Save**.
6. Enable the provider and mark it as preferred when you want it to be the default.

To keep inference local, start one of the supported runtimes and follow [Local models](/core/models/local-model).

## Configure tools and browser access

A model can reason about a task, but tools let it act.

- Add hosted integrations from [MCP Marketplace](/connectors/mcp-marketplace).
- Add your own local or remote server from [Custom MCP servers](/connectors/custom-mcp).
- Configure a CDP browser from [Browser connections](/browser/connections).
- Create a Space from a local folder when agents need direct access to project files.

> **Video placeholder:** Add a 60-90 second MP4 showing a local installation, model configuration, local-folder Space creation, and the first successful task. Include captions and a short transcript.

## Build a distributable application

Use the build script for the target platform:

```bash
npm run build
```

Platform-specific scripts include:

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

Review the Electron signing, packaging, and backend dependency requirements before distributing a build to other users.

## Update a self-hosted installation

1. Commit or back up local configuration changes.
2. Pull the target release or branch.
3. Review release notes and environment changes.
4. Reinstall dependencies when lockfiles changed.
5. Run the relevant tests and build command.
6. Start Eigent and validate models, connectors, browser sessions, and existing Spaces.

## Troubleshooting

### The application starts without a model

Open **Agents > Models** and configure at least one cloud, BYOK, or local provider. Eigent blocks new tasks when no valid model is available.

### A local model cannot be reached

Confirm that the runtime is running, the endpoint includes the expected `/v1` path, and the port is accessible from the Eigent process.

### MCP tools fail during startup

Review the MCP command, arguments, environment variables, and executable path. Run the server independently to confirm that it starts before adding it to Eigent.

### Browser connection fails

Confirm that Chrome or Chromium was started with remote debugging and that the configured port exposes `/json/version`.

## Next steps

<CardGroup>
  <Card title="Provider reference" icon="list" href="/models/provider-reference">
    Compare every cloud and local model provider supported by Eigent.
  </Card>
  <Card title="Open-source Eigent" icon="code-branch" href="/open-source/overview">
    Review the repository architecture and extension points.
  </Card>
  <Card title="Brain architecture" icon="diagram-project" href="/core/brain-architecture">
    Understand how the frontend, Brain backend, and services work together.
  </Card>
</CardGroup>
