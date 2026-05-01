# Image Analysis for Triggers Documentation

## Main/Overview Images

### task_queue.png

- Shows: "1 Queued Tasks" with a task labeled "say hi"
- UI element: "Splitting Tasks" button with gear icon
- Content: Shows how triggered tasks appear in the task queue
- Caption: "When a trigger fires, it creates a task that enters the task queue"

### execution_logs.png

- Shows: Execution logs for "my webhook" trigger
- Statistics: 1 Total Runs, 100% Success Rate
- Log entries with timestamps and status:
  - 05:50:27 - Execution in progress...
  - 05:50:14 - Execution was cancelled (2.5s)
  - 05:50:08 - Execution completed successfully (9.3s)
  - 05:49:47 - Execution completed successfully (12.0s)
  - 05:49:34 - Execution completed successfully (11.3s)
  - 05:48:33 - Execution completed successfully (29.0s)
- Caption: "Monitor trigger executions with detailed logs showing status, timestamps, and duration"

## Schedule Trigger Images

### schedule/Screenshot 2026-03-05 054330.png

- Shows: "Automate task with trigger" modal, Schedule tab selected
- Trigger Type: Schedule (selected) vs App Trigger
- Options: One Time, Daily, Weekly, Monthly tabs
- Fields visible:
  - Date: 03/05/2026
  - Hour: 05 (dropdown)
  - Minute: 41 (dropdown)
  - Max Failure Count: 5 (optional, description: "Number of consecutive failures before the trigger is automatically disabled")
- Caption: "Configure a schedule trigger by selecting the schedule type and frequency"

### schedule/Screenshot 2026-03-05 054354.png

- Shows: Same modal scrolled down
- Additional fields:
  - Expiration Date: mm/dd/yyyy (optional)
  - Max Failure Count: 5
  - Preview Scheduled Times (expandable):
    - March 6, 2026 at 5:41 AM GMT+3
    - March 7, 2026 at 5:41 AM GMT+3
    - March 8, 2026 at 5:41 AM GMT+3
    - March 9, 2026 at 5:41 AM GMT+3
    - March 10, 2026 at 5:41 AM GMT+3
- Caption: "View a preview of upcoming scheduled execution times before creating the trigger"

### schedule/Screenshot 2026-03-05 054418.png

- Shows: Days of Week selector
- Days: Sun, Mon, Tue, Wed, Thur, Fri, Sat
- Mon is selected (white background, others gray)
- Caption: "Select specific days of the week for weekly recurring triggers"

### schedule/Screenshot 2026-03-05 054441.png

- Shows: Monthly scheduling options
- Selected: "Monthly" tab
- Field: Day of Month (dropdown showing "1st")
- Help text: "If the selected day doesn't exist in that month (e.g., the 31st), the task will be skipped."
- Caption: "Configure monthly triggers by selecting the day of the month"

## Slack Trigger Images

### slack/1_create_app.png

- Shows: Slack API "Your Apps" page with modal open
- Modal title: "Name app & choose workspace"
- Fields:
  - App Name: "Demo"
  - Workspace dropdown: "MY FIRST WORKSPACE"
- Note: "By creating a Web API Application, you agree to the Slack API Terms of Service"
- Buttons: Cancel, Create App (green)
- Caption: "Create a new Slack app from the Slack API dashboard"

### slack/2_basic_info.png

- Shows: Slack app "Basic Information" page
- Section: "App Credentials"
- Fields displayed:
  - App ID
  - Date of App Creation: March 4, 2026
  - Client ID
  - Client Secret (hidden)
  - Signing Secret
- Left sidebar shows various settings and features
- Caption: "View your app's basic information and credentials in the Slack API dashboard"

### slack/3_oauth_scopes.png

- Shows: OAuth & Permissions - Scopes section
- Bot Token Scopes:
  - app_mentions:read - "View messages that directly mention @Demo in conversations that the app is in"
  - im:history - "View messages and other content in direct messages that 'Demo' has been added to"
- Button: "Add an OAuth Scope"
- Caption: "Add necessary OAuth scopes for your bot to read messages and mentions"

### slack/4_install_app.png

- Shows: OAuth & Permissions page
- Section: "Advanced token security via token rotation"
- Warning: "At least one redirect URL needs to be set below before this app can be opted into token rotation"
- OAuth Tokens section
- Button: "Install to MY FIRST WORKSPACE" (green)
- Caption: "Install your Slack app to your workspace to generate OAuth tokens"

### slack/5_install_app_process.png

- Shows: Permission approval page
- Title: "Allow the 'Demo' app to access Slack"
- Workspace: MY FIRST WORKSPACE
- Review app permissions section
- Information visible: "Content and info about channels & conversations"
- Buttons: Cancel, Allow (green)
- Caption: "Review and approve the permissions requested by your Slack app"

### slack/6_get_bottoken.png

- Shows: OAuth & Permissions page after installation
- Success banner: "You've changed the permission scopes your app uses. Please reinstall your app..."
- OAuth Tokens section showing:
  - Bot User OAuth Token: xoxb-... (with Copy button)
  - Access Level: Workspace
- Button: "Reinstall to MY FIRST WORKSPACE"
- Caption: "Copy the Bot User OAuth Token after installing the app to your workspace"

### slack/7_select_slack.png

- Shows: Eigent "Automate task with trigger" modal
- Trigger Type: Schedule | App Trigger (App Trigger selected)
- Select App section with grid:
  - Slack (logo)
  - Webhook (selected, highlighted)
  - Lark (Coming Soon)
  - Telegram (Coming Soon)
- Execution Settings section (collapsed)
- Caption: "Select Slack as the trigger app in Eigent's trigger configuration"

### slack/8_enter_creds.png

- Shows: "Slack Configuration" section in trigger modal
- Info box: "You can find your webhook URL in the trigger details after creation."
- Credentials section:
  - Slack Bot Token (password field with show/hide, Update button)
    - Help: "Your Slack Bot User OAuth Token (starts with xoxb-)"
  - Slack Signing Secret (password field with show/hide, Update button)
    - Help: "Your Slack app's signing secret used to verify requests"
- Success message: "✓ Credentials configured successfully"
- Caption: "Enter your Slack Bot Token and Signing Secret to authenticate the trigger"

### slack/9_listen_events.png

- Shows: Lower section of trigger configuration modal
- Fields:
  - Message Filter (Regex): "Enter regex pattern to filter messages..."
  - Event Types: "2 selected" (dropdown)
    - Selected tags: message, app_mention
  - Ignore Users: "Enter Slack user IDs (e.g., U1234567890)..."
  - Behavior Settings (collapsed section)
- Caption: "Configure which Slack events should trigger your workflow"

### slack/10_activate_trigger.png

- Shows: Eigent Triggers page
- Created trigger: "slack trigger" with warning icon
- Description: "search for me the weather"
- Type badge: "Slack"
- Toggle switch: Enabled (green)
- Caption: "Activate your Slack trigger from the triggers list"

### slack/11_activate_trigger_click_copy.png

- Shows: "Edit Trigger Agent" modal
- Trigger Type: App Trigger selected
- Slack Configuration section
- Webhook URL displayed: https://dev.eigent.ai/api/webhook/trigger/98d2a1c8-859a-4e9b-9257-74911f56156a
- Warning: "Pending Verification. A valid event message is required for Trigger Activation or disable trigger Authentication."
- Copy button next to URL
- Caption: "Copy the webhook URL to configure in your Slack app's Event Subscriptions"

### slack/12_enable_url.png

- Shows: Slack API Event Subscriptions page
- Toggle: "Enable Events" - currently Off
- Description: "Your app can subscribe to be notified of events in Slack... at a URL you choose."
- Caption: "Enable Event Subscriptions in your Slack app settings"

### slack/13_paste_url.png

- Shows: Slack API Event Subscriptions page with Events enabled
- Toggle: "Enable Events" - On (green)
- Request URL field showing: https://dev.eigent.ai/api/webhook/trigger/98d2a1c8-859a-4e9b-9257-74...
- Status: Verified ✓
- Additional options:
  - Delayed Events toggle (Off)
  - Subscribe to bot events (collapsed section)
- Caption: "Paste the webhook URL and verify it with Slack"

### slack/14_listen_events_slack.png

- Shows: Slack Event Subscriptions page - "Subscribe to bot events" section expanded
- Events subscribed:
  - app_mention - Subscribe to only the message events that mention your app or bot - Required Scope: app_mentions:read
  - message.im - A message was posted in a direct message channel - Required Scope: im:history
- Button: "Add Bot User Event"
- Another collapsed section: "Subscribe to events on behalf of users"
- Caption: "Subscribe to specific bot events that will trigger your workflow"

### slack/15_invite_bot.png

- Shows: Slack workspace channel view
- Channel: demo-ch
- Message input showing: "/invite @Demo"
- Bot status: "Not in channel" with "Enter" button
- Top shows onboarding cards for the channel
- Caption: "Invite your bot to the channel where you want it to listen for messages"

### slack/16_send_chat.png

- Shows: Slack channel after bot invitation
- System message: "Ahmed joined demo-ch. Also, Demo joined via invite."
- User message: "Ahmed: Hi there @Demo, what can you do?"
- Message input ready for typing
- Caption: "Test your integration by mentioning the bot in the channel"

## Webhook Trigger Images

### webhook/1_select_webhook.png

- Shows: Eigent "Automate task with trigger" modal
- Trigger Type: Schedule | App Trigger (App Trigger selected)
- Select App grid:
  - Slack
  - Webhook (selected, highlighted with border)
  - Lark (Coming Soon)
  - Telegram (Coming Soon)
- Caption: "Select Webhook as the trigger type"

### webhook/2_request_types.png

- Shows: Request Method dropdown
- Currently selected: POST
- Dropdown options: GET, POST (checkmark)
- Caption: "Choose the HTTP method (GET or POST) for your webhook"

### webhook/3_webhook_config.png

- Shows: "Extra Settings" section expanded
- Fields:
  - Max Failure Count: 5 ("Number of consecutive failures before the trigger is automatically disabled")
  - Message Filter (Regex): "Enter regex pattern to filter messages..."
  - Body Contains: "Enter text that must be in request body..." ("Only trigger if the request body contains this string")
  - Required Headers: "Enter header names (e.g., Content-Type, Authorization)..." (with + button)
- Caption: "Configure webhook filters and validation rules"

### webhook/4_common_app_settings.png

- Shows: Execution Settings section expanded
- Fields:
  - Max Per Hour: 0
  - Max Per Day: 0
- Caption: "Set rate limiting options to control webhook execution frequency"

### webhook/5_webhook_created.png

- Shows: "Webhook Created Successfully" modal
- Icon: Green lightning bolt in circle
- Webhook name: "my webhook"
- Method badge: GET
- Your Webhook URL: https://dev.eigent.ai/api/webhook/trigger/f9b48cef-7fbb-411f-aa19-b959e3a58ef2
- Copy button next to URL
- Button: "Got it"
- Caption: "Copy your unique webhook URL after creation"

### webhook/6_trigger_webhook.png

- Shows: Browser view of webhook URL
- URL: https://dev.eigent.ai/api/webhook/trigger/f9b48cef-7fbb-411f-aa19-b959e3a58ef2
- JSON response:

```json
{
  "success": true,
  "execution_id": "c9a49dd7-7125-44dc-9374-b3a9f13ab7bd",
  "message": "Webhook trigger delivered to client",
  "delivered": true,
  "session_id": "b9ed7788-58b0-46ee-bb0d-01bb8e906f56"
}
```

- Caption: "Trigger the webhook by visiting the URL or sending an HTTP request"

### webhook/7_task_running.png

- Shows: Eigent interface with Triggers page
- Created trigger: "my webhook" with description "say hi"
- Toggle: Enabled (green)
- Left sidebar shows Chat with tasks loading
- Notification toast: "Queued: my webhook - Task has been added to the project queue"
- Caption: "View your webhook trigger in the triggers list and monitor task execution"
