---
title: Dispatch and remote control
description: Control an active Eigent Space from a shareable remote web session.
icon: tower-broadcast
---

Dispatch provides channels for interacting with Eigent away from the desktop application.

The currently implemented channel is Remote Control. Telegram, Lark, and WhatsApp appear as future channels.

## Open Dispatch

1. Open a Space.
2. In the project sidebar, select **Dispatch**.

Remote Control requires an active Space because commands and desktop targets are scoped to that Space.

> **Screenshot placeholder:** Add a screenshot of Dispatch with the Remote Control card, connection status, and activity log visible.

## Start a Remote Control session

1. In Dispatch, find **Remote Control**.
2. Select **Start**.
3. Wait for Eigent to create the session.
4. Select **Copy link**.
5. Open the link on the remote device.

The remote page connects to the desktop bridge and targets the selected Space.

## Send a remote follow-up

1. Open the remote link.
2. Confirm the connected desktop target.
3. Enter a follow-up command.
4. Send it.
5. Review status updates on the remote page or desktop.

Remote commands become task input on the desktop side.

## Review activity

The Dispatch activity log can show:

- Session creation
- Remote connection
- Command delivery
- Command status
- Errors
- Session stop

Use it to determine whether a problem occurred in the remote page, server, desktop bridge, or active task.

## Stop a session

1. Return to Dispatch.
2. Select **Stop**.

Stop sessions when remote access is no longer required. A copied link should not be treated as permanent access.

> **Video placeholder:** Add a 60-90 second MP4 showing session creation on desktop, opening the link on mobile, sending a follow-up, receiving it on desktop, and stopping the session. Include captions.

## Messaging channels

Telegram, Lark, and WhatsApp are displayed as Coming soon. The separate Channels dashboard also marks channel support as Coming soon.

<Warning>
Do not document these messaging channels as available until setup and connection controls are enabled.
</Warning>

## Security

- Share remote links only with intended users.
- Stop the session after use.
- Avoid sending credentials through remote prompts.
- Confirm the active Space before creating the link.
- Review activity logs for unexpected commands.

## Troubleshooting

### Remote Control cannot start

Open a Space and confirm the desktop can reach the Eigent server.

### The remote page is disconnected

Confirm that the desktop application is running and the bridge is connected.

### A command does not reach the task

Review Dispatch logs, confirm the target, and retry after the desktop bridge reconnects.

## Related guides

- [Automation overview](/automation/overview)
- [Projects overview](/projects/overview)
- [Privacy](/settings/privacy)
