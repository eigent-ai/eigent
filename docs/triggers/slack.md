---
title: Slack Trigger
description: Trigger workflows from Slack messages, app mentions, and direct messages.
icon: slack
---

Slack triggers enable your workflows to respond to events in Slack, such as messages in channels, mentions of your bot, or direct messages. This creates seamless integration between your team communication and automated processes.

## Prerequisites

Before setting up a Slack trigger, you need to create a Slack app and obtain the necessary credentials from the [Slack API](https://api.slack.com/apps).

### Step 1: Create a Slack App

Go to Slack API Apps and click "Create New App". Choose "From scratch" and provide:

- **App Name**: A name for your app (e.g., "Demo")
- **Workspace**: Select the workspace where you want to install the app

![Slack API modal showing "Name app & choose workspace" with App Name field and workspace dropdown](/docs/images/triggers/slack/1_create_app.png)

### Step 2: View App Credentials

After creating the app, navigate to **Basic Information** to view your app credentials including App ID, Client ID, Client Secret, and Signing Secret.

![Slack app Basic Information page showing App Credentials section with App ID, Client ID, Client Secret, and Signing Secret](/docs/images/triggers/slack/2_basic_info.png)

### Step 3: Configure OAuth Scopes

Navigate to **OAuth & Permissions** and add the necessary bot token scopes. Click "Add an OAuth Scope" and add:

- `app_mentions:read` - View messages that directly mention your app
- `im:history` - View messages in direct messages

![OAuth & Permissions page showing Bot Token Scopes with app_mentions:read and im:history added](/docs/images/triggers/slack/3_oauth_scopes.png)

### Step 4: Install App to Workspace

Scroll down to the **OAuth Tokens** section and click "Install to Workspace" to generate your Bot User OAuth Token.

![OAuth & Permissions page with "Install to MY FIRST WORKSPACE" button visible](/docs/images/triggers/slack/4_install_app.png)

Review the permissions and click "Allow" to authorize the app.

![Slack permission approval page showing "Allow the 'Demo' app to access Slack" with workspace selection](/docs/images/triggers/slack/5_install_app_process.png)

### Step 5: Copy Bot Token

After installation, copy the **Bot User OAuth Token** (starts with `xoxb-`) - you'll need this for Eigent.

![OAuth & Permissions page showing Bot User OAuth Token with Copy button](/docs/images/triggers/slack/6_get_bottoken.png)

## Configuring the Slack Trigger in Eigent

### Step 1: Select Slack as Trigger Type

In Eigent, create a new trigger and select "App Trigger" tab, then choose "Slack" from the available apps.

![Eigent trigger modal showing App Trigger tab selected with Slack, Webhook, Lark, and Telegram options](/docs/images/triggers/slack/7_select_slack.png)

### Step 2: Enter Slack Credentials

Enter your Slack Bot Token and optionally the Slack Signing Secret (from Basic Information page) to verify requests.

![Slack Configuration section showing fields for Slack Bot Token and Slack Signing Secret with "Credentials configured successfully" message](/docs/images/triggers/slack/8_enter_creds.png)

### Step 3: Configure Event Types

Select which Slack events should trigger your workflow:

- **message** - Any message in channels the bot is in
- **app_mention** - When the bot is @mentioned

You can also configure:

- **Message Filter (Regex)**: Filter messages using regex patterns
- **Ignore Users**: Exclude specific Slack user IDs from triggering workflows

![Event Types configuration showing 2 selected events (message, app_mention) with Message Filter and Ignore Users fields](/docs/images/triggers/slack/9_listen_events.png)

### Step 4: Activate the Trigger

Save the trigger and toggle it to enabled. The trigger will show a warning icon until properly configured with Slack.

![Triggers list showing "slack trigger" with warning icon, enabled toggle, and description "search for me the weather"](/docs/images/triggers/slack/10_activate_trigger.png)

### Step 5: Configure Event Subscriptions in Slack

For real-time events, you need to enable Event Subscriptions in your Slack app:

First, edit the trigger in Eigent and copy the webhook URL:

![Edit Trigger Agent modal showing webhook URL with Copy button and "Pending Verification" warning](/docs/images/triggers/slack/11_activate_trigger_click_copy.png)

In your Slack app settings, navigate to **Event Subscriptions** and enable events:

![Slack Event Subscriptions page showing "Enable Events" toggle in Off position](/docs/images/triggers/slack/12_enable_url.png)

Paste the webhook URL in the **Request URL** field. Slack will verify the URL automatically.

![Event Subscriptions with Enable Events toggle On and Request URL showing "Verified" status](/docs/images/triggers/slack/13_paste_url.png)

### Step 6: Subscribe to Bot Events

Expand "Subscribe to bot events" and add the events you want to receive:

- `app_mention` - Subscribe to messages that mention your app
- `message.im` - Subscribe to direct messages

![Subscribe to bot events section showing app_mention and message.im events added](/docs/images/triggers/slack/14_listen_events_slack.png)

Click "Save Changes" to apply your configuration.

### Step 7: Invite Bot to Channel

In Slack, invite your bot to the channels where you want it to listen by typing `/invite @YourBotName`.

![Slack channel showing "/invite @Demo" being typed in message input with bot status "Not in channel"](/docs/images/triggers/slack/15_invite_bot.png)

## Testing Your Integration

Send a message in the configured channel or mention the bot to trigger your workflow.

![Slack channel showing user message "Hi there @Demo, what can you do?" after bot joined the channel](/docs/images/triggers/slack/16_send_chat.png)

## Available Event Types

| Event              | Description                    | Required Scope    |
| ------------------ | ------------------------------ | ----------------- |
| `app_mention`      | Bot is @mentioned in a channel | app_mentions:read |
| `message.im`       | New direct message to the bot  | im:history        |
| `message.channels` | Message in public channel      | channels:history  |
| `message.groups`   | Message in private channel     | groups:history    |

## Use Cases

- **Customer Support**: Auto-respond to support requests in #help channels
- **DevOps**: Trigger deployments from Slack commands
- **HR**: Process time-off requests via Slack messages
- **Sales**: Log leads from sales channel conversations
- **IT Helpdesk**: Create tickets from IT support requests

## Best Practices

- Use specific channels rather than monitoring all channels
- Set up regex filters to avoid triggering on irrelevant messages
- Add ignore users to prevent bot loops
- Include the bot's response format in your workforce instructions
- Test thoroughly before enabling in production channels
- Use app mentions for actions requiring human confirmation
