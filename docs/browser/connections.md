---
title: Browser connections
description: Launch a managed browser or connect an existing CDP-enabled browser.
icon: globe
---

The browser pool contains Chrome DevTools Protocol sessions that Eigent agents can use.

## Open a new browser

1. Open **Browser > Connections**.
2. Select **Open new browser**.
3. Wait for Eigent to launch the browser and add it to the pool.

The browser item displays its name and debugging port.

> **Screenshot placeholder:** Add a screenshot of the browser pool with two active browsers and their ports.

## Connect an existing browser

Start Chrome or Chromium with remote debugging enabled. For example:

```bash
google-chrome --remote-debugging-port=9222
```

The executable name differs by operating system and installation.

Then:

1. Open **Browser > Connections**.
2. Select **Connect existing browser**.
3. Enter the remote-debugging port.
4. Select **Connect**.

Eigent checks `http://localhost:<port>/json/version` before adding the browser.

## Choose a port

Use a port from `1` to `65535`. The port must:

- Belong to a running CDP-enabled browser
- Not already exist in the Eigent browser pool
- Be reachable from the Eigent application

## Remove a browser

1. Find the browser in the pool.
2. Select its delete action.
3. Confirm the removal.

Removing a browser disconnects it from Eigent. It does not necessarily close an external browser process.

## Use the browser in a task

1. Ensure a Browser worker is available.
2. Start a task that requires web interaction.
3. Open the Browser agent workspace in the Session.
4. Use Take Control when the agent requests manual interaction.

> **Video placeholder:** Add a 60-second MP4 showing Chrome started with remote debugging, connection through port `9222`, and a successful Browser-agent navigation. Include captions.

## Troubleshooting

### Invalid port

Enter a whole number between `1` and `65535`.

### Port already in use

The port is already registered in the browser pool. Use the existing item or start another browser on a different port.

### No browser found

Confirm that the browser is running with remote debugging and that `/json/version` responds.

### The browser disappears after restart

External browser processes and ports can change. Start the browser again and reconnect it.

## Related guides

- [Browser overview](/browser/overview)
- [Browser cookies](/browser/cookies)
