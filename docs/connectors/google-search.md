---
title: Google Search
description: Configure web search for managed and self-hosted Eigent deployments.
icon: magnifying-glass
---

Google Search provides current web results for Browser agents and research workflows.

## Determine your setup

### Managed Eigent mode

Google Search can be enabled by default and does not require user credentials.

### Self-hosted or custom mode

Provide:

- Google API key
- Google Custom Search Engine ID

## Create Google credentials

1. In Google Cloud, create or select a project.
2. Enable the Custom Search JSON API.
3. Create an API key with appropriate restrictions.
4. Create or select a Programmable Search Engine.
5. Copy its Search Engine ID.

Use Google's current Custom Search documentation for account-specific steps and quota information.

## Configure Search in Eigent

1. Open **Connectors**.
2. Select **Google Search**.
3. Enter the Google API key.
4. Enter the Search Engine ID.
5. Save the configuration.

> **Screenshot placeholder:** Add a screenshot of the Google Search configuration form. Blur the complete API key and Search Engine ID.

## Test Search

Start a small Browser-agent task, for example:

> Find the three most recent official release notes for Eigent and return their publication dates and source links.

Review the task log to confirm that the search tool returned results.

## Control cost and quota

Google Custom Search can enforce daily quotas or billing limits. Use a restricted key and monitor usage in Google Cloud.

## Troubleshooting

### Invalid API key

Confirm that the key is active, the Custom Search JSON API is enabled, and API restrictions allow the service.

### Invalid Search Engine ID

Copy the identifier from the Programmable Search Engine control panel, not the display name.

### Empty results

Review the search engine's site scope and settings. A search engine restricted to selected sites will not return the full web.

### Quota exceeded

Review the current quota and billing settings in Google Cloud.

> **Video placeholder:** Add a 45-second MP4 showing credential entry, saving, and a successful Browser-agent search. Include captions.

## Related guides

- [Connectors overview](/connectors/overview)
- [Browser overview](/browser/overview)
- [Self-hosting](/get_started/self-hosting)
