---
title: Remote sub-agents
description: Connect a remote Gemini agent and delegate work from Eigent.
icon: network-wired
---

Remote sub-agents let Eigent delegate a unit of work to an externally hosted agent and poll for the result. Use them when another agent platform provides specialized capabilities or isolated execution.

The current interface supports a Gemini remote sub-agent provider.

## Before you begin

Prepare:

- A Gemini API key
- The remote service base URL
- The configured remote agent name
- A maximum wall-time value
- A polling interval

Use a dedicated credential with the minimum required permissions.

## Open Sub-agents

1. Open the Eigent dashboard.
2. Select **Agents**.
3. Select **Sub-agents**.
4. Select the Gemini provider.

> **Screenshot placeholder:** Add a screenshot of the Sub-agents configuration page. Blur the API key and any private endpoint.

## Configure the provider

1. Enter the Gemini API key.
2. Confirm or change the base URL.
3. Enter the remote agent name.
4. Set the maximum wall time in seconds.
5. Set the polling interval in seconds.
6. Select **Save**.

Eigent validates the connection before saving an enabled provider.

## Enable the provider

Use the provider switch to enable or disable delegation.

When enabling an existing provider, Eigent validates required fields and the remote connection. If validation fails, the provider returns to its previous state.

## Choose timing values

### Maximum wall time

Maximum wall time limits how long Eigent waits for the remote task to finish. Set it high enough for the expected work, but low enough to prevent indefinite jobs.

### Poll interval

Poll interval controls how frequently Eigent checks the remote task. Short intervals produce faster updates but increase request volume.

Start with conservative values and adjust them after observing typical task duration.

## Reset the provider

1. Open the remote sub-agent configuration.
2. Select the reset action.
3. Confirm the removal.

Reset deletes the stored provider record and restores the default form.

> **Video placeholder:** Add a 45-60 second MP4 showing provider configuration, validation, enable and disable, and reset. Use test credentials and include captions.

## Troubleshooting

### Required-fields error

Confirm the API key, base URL, agent name, maximum wall time, and polling interval. Timing values must be positive numbers.

### Validation fails

Check the API key, endpoint, agent name, network proxy, and provider availability.

### Remote tasks time out

Increase maximum wall time or reduce the scope of delegated work.

### Polling causes rate limits

Increase the polling interval.

## Related guides

- [Agents overview](/agents/overview)
- [General settings](/settings/general)
- [Privacy](/settings/privacy)
