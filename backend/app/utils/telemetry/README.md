# Workforce Telemetry

OpenTelemetry-based telemetry for CAMEL workforce events, sent to Langfuse for observability.

## Configuration

Add the following environment variables to `~/.eigent/.env`:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com  # Optional, defaults to US cloud
```

**If these keys are not specified, telemetry will be disabled.**

## Langfuse Setup

- **Cloud**: Sign up at [Langfuse Cloud](https://cloud.langfuse.com)
- **Self-hosted**: Use the [open-source version](https://langfuse.com/self-hosting)
- **Documentation**: [https://langfuse.com/docs](https://langfuse.com/docs)

## Privacy

Only **metadata** is captured (task IDs, timings, model names, token counts, quality scores). **No PII or detailed task content** is sent to Langfuse.

## Captured Attributes

- `eigent.project.id`, `eigent.task.id`
- `eigent.worker.agent` (e.g., developer_agent, browser_agent)
- `eigent.worker.model.name`, `eigent.worker.model.platform`
- `eigent.task.quality_score`, `eigent.task.timestamp`
- `eigent.task.token_usage.*`, `eigent.task.processing_time_seconds`
- `langfuse.session.id`, `langfuse.tags`
