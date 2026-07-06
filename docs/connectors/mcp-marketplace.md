---
title: MCP Marketplace
description: Install, configure, enable, and remove supported connector integrations.
icon: store
---

The MCP Marketplace provides guided installation for supported services. Use it before creating a custom MCP configuration because marketplace integrations include service-specific defaults and credential fields.

## Browse integrations

1. Open **Connectors**.
2. Expand the supported integration section.
3. Use search to find a service.
4. Select the integration.

Connected services appear before unconnected services. Coming-soon services appear after available integrations.

> **Screenshot placeholder:** Add a screenshot of the connector catalog with one connected integration, one available integration, and one Coming soon item.

## Install an integration

The exact flow depends on the service:

1. Select the integration.
2. Select **Install** or **Connect**.
3. Complete OAuth or enter required environment variables.
4. Save the configuration.
5. Enable the connector.

Notion and other services can open a dedicated authentication flow. Other integrations request keys or tokens directly.

## Configure environment variables

1. Select a connected integration.
2. Open its configuration.
3. Enter each required environment value.
4. Save the changes.

Use credentials created specifically for Eigent. Avoid personal administrator tokens.

## Enable or disable an integration

Use the connector switch to control whether its tools are available.

Disabling a connector preserves its configuration but prevents new agent use. Existing external sessions can remain active at the provider until revoked.

## Edit an integration

1. Open the integration actions.
2. Select **Edit** or **Configure**.
3. Update the required values.
4. Save.
5. Run a test task.

## Uninstall an integration

1. Open the integration actions.
2. Select **Uninstall**.
3. Confirm the action.

Uninstalling removes the Eigent connector configuration. Revoke OAuth grants or provider tokens separately when required.

## Assign the integration to a worker

1. Open the Workspace.
2. Add or edit a worker.
3. Select the integration from **Agent Tool**.
4. Save the worker.

The worker can use only the tools assigned to it.

> **Video placeholder:** Add a 60-second MP4 showing installation, credential configuration, enable and disable, and worker assignment for one integration. Include captions.

## Troubleshooting

### Installation completes but the connector is not shown as connected

Refresh the connector list and confirm that required credentials were saved.

### A tool returns an authorization error

Reconnect the integration or replace the expired credential.

### The desired service is not listed

Use [Custom MCP servers](/connectors/custom-mcp).

## Related guides

- [Connectors overview](/connectors/overview)
- [Workers](/core/workers)
- [Privacy](/settings/privacy)
