---
title: Triggers Overview
description: Learn how to automate your workflows with different trigger types in Eigent.
icon: bolt
---

Triggers are events that automatically start your workflows. Instead of manually initiating tasks, you can configure triggers to run workflows based on schedules, external events, or incoming data.

## How Triggers Work

When a trigger fires, it creates a task that enters the task queue. Workers then pick up and execute these tasks according to their configured capabilities and availability.

![Task Queue showing a triggered task labeled "say hi" with "Splitting Tasks" option visible](/docs/images/triggers/task_queue.png)

### Key Concepts

- **Trigger**: An event source that initiates workflows
- **Task**: A unit of work created when a trigger fires
- **Execution**: The actual running of a task by a worker
- **Queue**: Tasks waiting to be processed

## Execution Monitoring

Once a trigger fires and creates a task, you can monitor its execution through the logs. Each execution is tracked with timestamps, status, and duration.

![Execution logs showing "my webhook" trigger with 1 total run, 100% success rate, and execution history with timestamps and durations](/docs/images/triggers/execution_logs.png)

The execution logs display:

- Total number of runs
- Success rate percentage
- Individual execution status (in progress, completed, cancelled)
- Execution timestamps
- Duration of each run

## Trigger Types

Eigent supports multiple trigger types to integrate with your existing tools and workflows:

<CardGroup cols={2}>
  <Card title="Schedule" icon="clock" href="/triggers/schedule">
    Run workflows at specific times or intervals. Supports one-time, daily, weekly, and monthly schedules with customizable time settings.
  </Card>
  <Card title="Slack" icon="slack" href="/triggers/slack">
    Trigger workflows from Slack messages, app mentions, and direct messages. Perfect for team collaboration and support workflows.
  </Card>
  <Card title="Webhook" icon="webhook" href="/triggers/webhook">
    Receive HTTP requests from external services via unique URLs. Integrate with any service that supports webhooks.
  </Card>
</CardGroup>

## Best Practices

- **Schedule triggers**: Use for recurring tasks like daily reports, periodic data sync, or routine maintenance
- **Slack triggers**: Ideal for team collaboration, customer support, and human-in-the-loop workflows
- **Webhook triggers**: Perfect for integrating with external systems, CI/CD pipelines, and third-party services
- Monitor execution logs regularly to ensure triggers are firing correctly
- Set appropriate max failure counts to prevent runaway triggers
- Use filters and validation to ensure only relevant events trigger your workflows
