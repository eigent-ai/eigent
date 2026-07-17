---
title: Custom MCP servers
description: Add local command-based or remote URL-based Model Context Protocol servers.
icon: wrench
---

Use a custom Model Context Protocol server when you need a tool that is not included in Eigent's supported integration catalog.

Eigent supports:

- Local MCP servers started with a command
- Remote MCP servers reached through a URL

## Review the server before installation

An MCP server can read data, call APIs, or execute actions. Before adding one:

- Read its source code or trusted documentation.
- Review requested permissions.
- Inspect commands and arguments.
- Confirm how credentials are stored.
- Test it with a restricted account.

## Add a local MCP server

1. Open **Connectors**.
2. Select **Add MCP**.
3. Choose **Local**.
4. Paste the MCP JSON configuration.
5. Review the command and arguments.
6. Select **Install**.

Example:

```json
{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    }
  }
}
```

Use an absolute executable path when the Electron process cannot resolve the command through the normal shell environment.

> **Screenshot placeholder:** Add a screenshot of the local MCP JSON dialog with a safe example server configuration.

## Add a remote MCP server

1. Open **Connectors**.
2. Select **Add MCP**.
3. Choose **Remote**.
4. Enter a display name.
5. Enter the remote server URL.
6. Save the configuration.

Use HTTPS for remote servers outside a trusted local network.

## Configure environment variables

1. Select the MCP server.
2. Open its environment configuration.
3. Add the required keys and values.
4. Save.

Never place production secrets directly in public configuration examples.

## Enable and test the server

1. Enable the MCP server.
2. Add it to a test worker.
3. Start a small task that uses one tool.
4. Review the task log for the tool call and result.

## Edit or delete a server

Use the server actions to update command arguments, URL, description, or environment values. Delete the server when it is no longer required.

Deleting an MCP entry does not revoke credentials at the external service.

> **Video placeholder:** Add a 90-second MP4 showing local and remote MCP setup, environment configuration, worker assignment, and a test call. Include captions.

## Troubleshooting

### The local command is not found

Use an absolute path or ensure the executable is installed in the environment used by Eigent.

### The process exits immediately

Run the command in a terminal and inspect its output. Confirm arguments and required environment variables.

### A remote URL cannot be reached

Check DNS, TLS, authentication, proxy settings, and firewall rules.

### Tools do not appear

Enable the MCP server, restart it if required, and assign it to the worker.

## Related guides

- [Connectors overview](/connectors/overview)
- [MCP Marketplace](/connectors/mcp-marketplace)
- [Workers](/core/workers)
