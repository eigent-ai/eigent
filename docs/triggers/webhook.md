---
title: Webhook Trigger
description: Trigger workflows via HTTP requests from external services using unique webhook URLs.
icon: webhook
---

Webhook triggers allow external services to initiate workflows by sending HTTP requests to a unique URL. This enables integration with virtually any service that supports webhooks, including GitHub, Stripe, Zapier, and custom applications.

## Setting Up a Webhook Trigger

### Step 1: Select Webhook Trigger

Create a new trigger and select "App Trigger" tab, then choose "Webhook" from the available options.

![Trigger modal showing App Trigger tab with Webhook option selected alongside Slack, Lark, and Telegram](/docs/images/triggers/webhook/1_select_webhook.png)

### Step 2: Configure Request Method

Choose the HTTP method your webhook should accept:

- **GET**: For simple requests and testing
- **POST**: For sending data payloads (most common)

![Request Method dropdown showing POST selected with GET and POST options](/docs/images/triggers/webhook/2_request_types.png)

### Step 3: Configure Extra Settings

Set up validation and filtering rules for your webhook:

- **Max Failure Count**: Number of consecutive failures before the trigger is automatically disabled (default: 5)
- **Message Filter (Regex)**: Use regex patterns to filter which requests trigger the workflow
- **Body Contains**: Only trigger if the request body contains specific text
- **Required Headers**: Specify required HTTP headers (e.g., Content-Type, Authorization)

![Extra Settings section showing Max Failure Count, Message Filter, Body Contains, and Required Headers fields](/docs/images/triggers/webhook/3_webhook_config.png)

### Step 4: Set Execution Limits

Configure rate limiting to prevent abuse:

- **Max Per Hour**: Maximum number of executions per hour (0 = unlimited)
- **Max Per Day**: Maximum number of executions per day (0 = unlimited)

![Execution Settings section showing Max Per Hour and Max Per Day fields set to 0](/docs/images/triggers/webhook/4_common_app_settings.png)

### Step 5: Create and Copy Webhook URL

After configuring, click "Create" to generate your unique webhook URL.

![Webhook Created Successfully modal showing webhook name "my webhook", method GET, and the webhook URL with Copy button](/docs/images/triggers/webhook/5_webhook_created.png)

**Important**: Copy this URL - you'll need to configure it in your external service.

## Using Your Webhook

### Step 1: Configure External Service

Paste the webhook URL into your external service's webhook settings. Examples:

- **GitHub**: Repository Settings → Webhooks → Add webhook
- **Stripe**: Dashboard → Developers → Webhooks → Add endpoint
- **Zapier**: Create Zap → Webhooks by Zapier
- **Custom apps**: Use the URL in your API calls

### Step 2: Trigger the Webhook

Test the webhook by visiting the URL in your browser (for GET requests) or sending an HTTP request.

![Browser showing JSON response from webhook URL with success status, execution_id, and message "Webhook trigger delivered to client"](/docs/images/triggers/webhook/6_trigger_webhook.png)

The response includes:

- `success`: Boolean indicating if the trigger was accepted
- `execution_id`: Unique ID for this execution
- `message`: Status message
- `delivered`: Whether the trigger was successfully delivered
- `session_id`: Session identifier

### Step 3: Monitor Execution

When the webhook fires, Eigent creates a task and adds it to the project queue.

![Eigent interface showing Triggers page with "my webhook" enabled and notification "Queued: my webhook - Task has been added to the project queue"](/docs/images/triggers/webhook/7_task_running.png)

View execution logs to see the payload and processing results.

## Security Best Practices

### Rate Limiting

Always set appropriate Max Per Hour/Day limits to prevent abuse:

- **Development**: 100/hour, 1000/day
- **Production**: Depends on expected volume

### Request Validation

Use these methods to secure your webhooks:

1. **Required Headers**: Enforce Content-Type, Authorization, or custom headers
2. **Body Contains**: Verify specific strings in the request body
3. **Regex Filtering**: Use complex patterns to validate request structure

### Authentication

While Eigent webhooks use unique URLs (which act as tokens), you can add additional security:

- Add an `Authorization` header requirement
- Include a secret token in the request body
- Use IP whitelisting on your external service

## Use Cases

- **CI/CD Pipelines**: Trigger deployments from GitHub/GitLab webhooks
- **E-commerce**: Process orders from Stripe/PayPal payment webhooks
- **Monitoring**: Handle alerts from PagerDuty/Datadog
- **CRM Integration**: Sync customer data from Salesforce/HubSpot
- **Form Submissions**: Process Typeform/Google Forms submissions
- **IoT Devices**: Respond to device events and sensor data

## Troubleshooting

### Webhook Not Firing

1. Verify the URL is correctly entered in the external service
2. Check if the external service shows successful delivery attempts
3. Ensure the webhook is toggled ON in Eigent
4. Review execution logs for any errors

### Payload Not Received

1. Check the Content-Type header (should be application/json for JSON payloads)
2. Verify the payload matches your "Body Contains" filter if configured
3. Ensure required headers are present
4. Check if regex filter is too restrictive

### Too Many Requests

1. Check Max Per Hour/Day limits
2. Verify the external service isn't sending duplicate requests
3. Consider adding deduplication logic in your workflow
