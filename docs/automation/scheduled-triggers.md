---
title: Scheduled triggers
description: Run project tasks once or on daily, weekly, and monthly schedules.
icon: clock
---

Scheduled triggers run a saved task prompt at a configured time. Use them for recurring reports, monitoring, content updates, reminders, and other predictable work.

## Before you begin

Prepare:

- A Project in the active Space
- A model and required tools
- A prompt that can run without additional clarification
- A schedule and time zone

Test the prompt manually before automating it.

## Create a one-time schedule

1. Open **Scheduled**.
2. Select **Create**.
3. Enter a trigger name and task prompt.
4. Select **Schedule**.
5. Choose **One time**.
6. Select the date, hour, and minute.
7. Set the maximum failure count.
8. Create the trigger.

## Create a recurring schedule

Choose one of:

- **Daily:** Runs every day at the selected time.
- **Weekly:** Runs on selected weekdays.
- **Monthly:** Runs on a selected day of the month.
- **Custom cron:** Uses a five-part cron expression.

Optional: Set an expiration date so the trigger stops creating new executions.

> **Screenshot placeholder:** Add a screenshot of the schedule picker with weekly frequency, selected weekdays, execution time, expiration, and upcoming-run preview visible.

## Understand time conversion

The schedule picker displays local time and converts it to a UTC cron expression for storage.

Review the upcoming execution preview before saving. Daylight-saving changes can affect local-time expectations for long-running schedules.

## Use a custom cron expression

A standard five-part expression contains:

```text
minute hour day-of-month month day-of-week
```

Example:

```text
0 9 * * 1-5
```

This represents 09:00 on weekdays in the cron time zone used by the system.

Use the visual schedule options when possible because they also provide validation and execution previews.

## Activate or deactivate a schedule

Use the trigger switch to stop or resume future executions without deleting the configuration.

Deactivating a trigger does not cancel a task that already started.

## Review executions

Open execution logs to review:

- Scheduled time
- Start and completion
- Failure details
- Retry status
- Token cost when available

> **Video placeholder:** Add a 60-second MP4 showing weekly schedule creation, upcoming execution preview, activation, and execution-log review. Include captions.

## Troubleshooting

### The trigger ran at the wrong local time

Review the time zone, UTC conversion, and daylight-saving changes.

### No execution was created

Confirm that the trigger is active, has not expired, and still belongs to an available Project.

### Repeated failures stop the trigger

Review the maximum failure count, task prompt, model, and connector availability.

## Related guides

- [Automation overview](/automation/overview)
- [Webhook and app triggers](/automation/webhook-triggers)
