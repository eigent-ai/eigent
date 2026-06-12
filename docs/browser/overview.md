---
title: Browser overview
description: Give Eigent agents controlled access to browser sessions and authenticated websites.
icon: compass
---

Eigent can launch or connect to Chrome DevTools Protocol browsers for research and browser automation. Browser agents can navigate pages, interact with controls, capture screenshots, and maintain session state.

## Open Browser settings

1. Open the Eigent dashboard.
2. Select **Browser**.
3. Choose **Connections**, **Plugins**, or **Cookies**.

> **Screenshot placeholder:** Add a screenshot of the Browser settings page with the three navigation items and an active browser pool.

## Browser Connections

Connections manage browsers available to agents. You can:

- Open a new managed browser
- Connect an existing CDP-enabled browser
- Review browser names and ports
- Remove a browser from the pool

See [Browser connections](/browser/connections).

## Browser Cookies

Cookies let agents use authenticated sessions. Open a dedicated login browser, sign in to required services, then let Eigent import the resulting cookie domains.

See [Browser cookies](/browser/cookies).

## Browser Plugins

Browser Plugins are currently marked **Coming soon**.

<Note>
Do not present browser extension or plugin features as available until the product page includes active installation controls.
</Note>

## Use a browser in a Session

When a Browser agent starts work, its workspace appears in the Project Session.

The agent can:

- Search and navigate
- Click and type
- Read page content
- Capture visual state
- Use available authenticated cookies

When manual interaction is required, use **Take Control**, complete the action, and return control to the agent.

## Security

- Use a dedicated browser profile.
- Avoid storing unnecessary privileged sessions.
- Delete cookies when a task no longer needs them.
- Review actions before giving an agent access to sensitive services.
- Do not connect a remote-debugging port to an untrusted network.

> **Video placeholder:** Add a 60-second MP4 showing a browser connection, a Browser-agent task, Take Control, and return of control. Include captions.

## Related guides

- [Browser connections](/browser/connections)
- [Browser cookies](/browser/cookies)
- [Google Search](/connectors/google-search)
