---
title: Browser cookies
description: Add authenticated browser sessions and manage cookies by domain.
icon: cookie
---

Browser cookies let agents use authenticated websites without entering credentials during every task.

Cookies can grant account access. Use a dedicated profile and remove sessions that are no longer required.

## Open Cookie management

1. Open the Eigent dashboard.
2. Select **Browser**.
3. Select **Cookies**.

The page groups cookie records by main domain and shows the total cookie count for each group.

> **Screenshot placeholder:** Add a screenshot of the Cookies page with several sample domains and cookie counts. Do not show real customer or personal domains.

## Add authenticated cookies

1. Select **Open browser**.
2. Sign in to the required websites.
3. Close the login browser when finished.
4. Wait for Eigent to refresh the cookie list.
5. Restart Eigent when prompted.

The restart makes the new cookie state available to browser automation.

## Refresh the cookie list

Select the refresh control to reload available domains and counts.

Use refresh after completing another login or when the list appears stale.

## Delete a domain

1. Find the main domain.
2. Select its delete action.
3. Confirm the deletion.

Eigent deletes cookies for the main domain and its listed subdomains.

## Delete all cookies

1. Select **Delete all**.
2. Confirm the action.
3. Restart Eigent when prompted.

This removes all browser cookie records managed by this feature.

> **Video placeholder:** Add a 60-second MP4 showing login, cookie import, domain deletion, and restart. Use a test account and include captions.

## Security guidance

- Prefer test or dedicated automation accounts.
- Do not import sessions with broad administrative access unless required.
- Remove cookies after temporary work.
- Protect local user data and backups containing browser state.
- Never include cookie values in screenshots or support requests.

## Troubleshooting

### No new cookies appear

Confirm that login completed, the login browser was closed, and the target site actually stored cookies.

### A website still asks for login

Restart Eigent, confirm the domain appears in the list, and check whether the website uses another domain or additional authentication.

### Deleting cookies does not sign out immediately

Restart Eigent and close other browser sessions. The service can also maintain server-side sessions until they expire or are revoked.

## Related guides

- [Browser overview](/browser/overview)
- [Browser connections](/browser/connections)
- [Privacy](/settings/privacy)
