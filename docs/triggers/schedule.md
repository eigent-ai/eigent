---
title: Schedule Trigger
description: Automate recurring workflows with flexible scheduling options including one-time, daily, weekly, and monthly schedules.
icon: clock
---

Schedule triggers allow you to run workflows automatically at specified times or intervals. This is ideal for recurring tasks like daily reports, periodic data synchronization, or routine maintenance.

## Setting Up a Schedule Trigger

### Step 1: Select Schedule Trigger Type

Create a new trigger and select "Schedule" from the trigger type options. You'll see two main tabs: "Schedule" and "App Trigger" - make sure Schedule is selected.

![Schedule trigger configuration modal showing Schedule tab selected with One Time, Daily, Weekly, and Monthly frequency options](/docs/images/triggers/schedule/Screenshot%202026-03-05%20054330.png)

### Step 2: Choose Schedule Frequency

Select your desired frequency from the available options:

- **One Time**: Run once at a specific date and time
- **Daily**: Run every day at the specified time
- **Weekly**: Run on specific days of the week
- **Monthly**: Run on a specific day of each month

### Step 3: Configure Date and Time

Set the specific date, hour, and minute for your trigger:

- **Date**: Select the start date (format: mm/dd/yyyy)
- **Hour**: Choose the hour (00-23)
- **Minute**: Choose the minute (00-59)

You can also set an optional **Expiration Date** if you want the trigger to stop running after a specific date.

### Step 4: Preview Scheduled Times

Before creating the trigger, expand the "Preview Scheduled Times" section to see exactly when your trigger will run in the upcoming days.

![Preview section showing upcoming execution times like "March 6, 2026 at 5:41 AM GMT+3" for the next 5 days](/docs/images/triggers/schedule/Screenshot%202026-03-05%20054354.png)

This helps verify your schedule is configured correctly.

### Step 5: Set Failure Threshold

Configure the **Max Failure Count** (default: 5) - this is the number of consecutive failures before the trigger is automatically disabled. This safety feature prevents problematic triggers from running indefinitely.

## Schedule Types

### One Time

Run the workflow once at a specific date and time. Perfect for scheduled maintenance or one-off tasks.

### Daily

Run the workflow every day at the same time. Configure:

- Date: When to start
- Hour and Minute: What time to run

### Weekly

Run the workflow on specific days of the week. Configure:

- Select multiple days (Sun, Mon, Tue, Wed, Thur, Fri, Sat)
- Set the time (Hour and Minute)

![Weekly schedule configuration showing day selector with Monday highlighted](/docs/images/triggers/schedule/Screenshot%202026-03-05%20054418.png)

### Monthly

Run the workflow on a specific day of each month. Configure:

- Day of Month: Select from 1st to 31st
- Set the time (Hour and Minute)

![Monthly schedule configuration showing "Day of Month" dropdown with 1st selected](/docs/images/triggers/schedule/Screenshot%202026-03-05%20054441.png)

<Note>
If the selected day doesn't exist in that month (e.g., the 31st), the task will be skipped for that month.
</Note>

## Use Cases

- **Daily Reports**: Generate and send daily analytics summaries at 9 AM
- **Data Sync**: Synchronize data between systems every hour
- **Weekly Maintenance**: Run cleanup tasks every Sunday at midnight
- **Monthly Billing**: Process invoices on the 1st of each month
- **Periodic Monitoring**: Check system health every 15 minutes

## Best Practices

- Always check the "Preview Scheduled Times" to verify your schedule
- Set an expiration date for temporary or test triggers
- Use appropriate max failure counts (5 is usually sufficient)
- Consider timezone differences when scheduling for global teams
- Monitor execution logs regularly to ensure triggers run as expected
