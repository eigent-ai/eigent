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

## Span Structure

All spans share common resource attributes and scope information:

```json
{
  "resourceAttributes": {
    "service.name": "eigent-workforce",
    "eigent.project.id": "1768815931733-6575",
    "eigent.task.id": "1768815944094-9806"
  },
  "scope": {
    "name": "eigent.workforce",
    "version": "0.2.83a9"
  }
}
```

### worker.created

Emitted when a worker is created.

```json
{
  "attributes": {
    "eigent.worker.id": "73d20286-2c17-467a-8153-2a6ea8cbb6c2",
    "eigent.worker.type": "SingleAgentWorker",
    "eigent.worker.role": "Developer Agent: A master-level coding...",
    "eigent.worker.agent": "developer_agent",
    "eigent.worker.model.type": "gpt-4.1-mini"
  }
}
```

### task.created

Emitted when a task is created.

```json
{
  "attributes": {
    "eigent.task.id": "1768815944094-9806.1",
    "eigent.task.description": "Task description",
    "eigent.project.id": "1768815931733-6575",
    "eigent.task.parent_id": "1768815944094-9806",
    "eigent.task.type": "task_type"
  }
}
```

### task.assigned

Emitted when a task is assigned to a worker.

```json
{
  "attributes": {
    "eigent.task.id": "1768815944094-9806.1",
    "eigent.worker.id": "0fae2d3d-7c0a-4b50-b09d-da35ae61786d",
    "eigent.project.id": "1768815931733-6575",
    "eigent.task.queue_time_seconds": "1.5",
    "eigent.task.dependencies": "[\"dep_1\", \"dep_2\"]"
  }
}
```

### task.execution:{task_id}

Long-running span tracking task execution from start to completion.

```json
{
  "attributes": {
    "eigent.task.id": "1768815944094-9806.1",
    "eigent.project.id": "1768815931733-6575",
    "eigent.task.status": "completed",
    "eigent.worker.id": "0fae2d3d-7c0a-4b50-b09d-da35ae61786d",
    "eigent.task.timestamp": "2026-01-19T09:46:40.045077+00:00",
    "eigent.task.parent_id": "1768815944094-9806",
    "eigent.task.processing_time_seconds": "10.926168203353882",
    "eigent.task.quality_score": "80",
    "eigent.task.token_usage.total_tokens": "37284"
  }
}
```

### workforce.all_tasks_completed

Emitted when all tasks in the workforce are completed.

```json
{
  "attributes": {
    "eigent.project.id": "1768815931733-6575",
    "eigent.task.id": "1768815944094-9806",
    "eigent.task.timestamp": "2026-01-19T09:46:44.901068+00:00",
    "workforce.total_tasks": "5"
  }
}
```

### log.message

Emitted for error and critical log messages.

```json
{
  "attributes": {
    "log.level": "error",
    "log.message": "Error message",
    "eigent.project.id": "1768815931733-6575"
  }
}
```

## Captured Attributes Reference

### Project & Task

- `eigent.project.id` - Workforce/project identifier
- `eigent.task.id` - Task identifier
- `eigent.task.description` - Task description
- `eigent.task.parent_id` - Parent task ID
- `eigent.task.type` - Task type
- `eigent.task.status` - Task status (started, completed, failed)
- `eigent.task.timestamp` - ISO 8601 timestamp
- `eigent.task.dependencies` - JSON array of dependency task IDs
- `eigent.task.queue_time_seconds` - Time in queue before assignment
- `eigent.task.processing_time_seconds` - Task execution duration
- `eigent.task.quality_score` - Quality score (0-100)

### Worker

- `eigent.worker.id` - Worker UUID
- `eigent.worker.type` - Worker class type
- `eigent.worker.role` - Worker role description
- `eigent.worker.agent` - Agent type (developer_agent, browser_agent, etc.)
- `eigent.worker.model.type` - Model name (gpt-4, claude-3, etc.)

### Token Usage

- `eigent.task.token_usage.total_tokens` - Total tokens used
- `eigent.task.token_usage.*` - Additional token usage metrics

### Langfuse

- `langfuse.session.id` - Set to project ID for grouping
- `langfuse.tags` - ["workforce", "camel", "eigent"]

### Workforce

- `workforce.total_tasks` - Total number of tasks completed
