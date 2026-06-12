---
title: Webhook and app triggers
description: Start Eigent tasks from HTTP requests or supported application events.
icon: webhook
---

Webhook and app triggers start tasks when an external event occurs.

Use a webhook for a custom system. Use an application trigger when Eigent provides a guided integration for the event source.

## Create a webhook trigger

1. Open **Scheduled**.
2. Select **Create**.
3. Enter a trigger name and task prompt.
4. Select **App**.
5. Choose **Webhook**.
6. Select the HTTP method.
7. Configure optional execution settings.
8. Create the trigger.

Eigent generates the webhook URL after creation.

> **Screenshot placeholder:** Add a screenshot of the webhook configuration and the post-creation URL dialog. Obscure most of the URL token.

## Call the webhook

Use the generated URL from the external service. A simplified request can look like:

```bash
curl -X POST "https://example.com/api/your-webhook-url" \
  -H "Content-Type: application/json" \
  -d '{"event":"new_record","id":"123"}'
```

The real URL and accepted payload depend on the deployment and trigger configuration.

Treat the URL as a credential. Do not commit it to a public repository.

## Configure execution limits

For event-driven triggers, configure:

- Maximum executions per hour
- Maximum executions per day
- Authentication or verification values
- Other dynamically loaded provider settings

Rate limits reduce the impact of loops or high-volume events.

## Create a Slack trigger

1. Install and authenticate the Slack connector.
2. Create a new App trigger.
3. Select **Slack**.
4. Complete the dynamically loaded event configuration.
5. Enter the task prompt.
6. Save and activate the trigger.

A pending-authentication state means additional verification is required.

## Use event data in the task

Write the trigger prompt so the agent understands:

- What the event represents
- Which fields are relevant
- What output to create
- Where to send or store the result
- When to stop or request review

## Review and retry executions

Use execution logs to review event receipt, task creation, completion, and errors. Retry only after fixing the underlying model, credential, prompt, or connector issue.

> **Video placeholder:** Add a 90-second MP4 showing webhook creation, a test `curl` request, execution logs, and a Slack trigger configuration. Include captions.

## Troubleshooting

### The webhook returns an error

Confirm the method, URL, authentication, and deployment base address.

### The event creates too many tasks

Deactivate the trigger, add hourly and daily limits, and fix the external event rule.

### Slack remains pending authentication

Reconnect Slack and complete the required verification fields.

## Related guides

- [Automation overview](/automation/overview)
- [MCP Marketplace](/connectors/mcp-marketplace)
- [Privacy](/settings/privacy)
