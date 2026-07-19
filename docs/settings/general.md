---
title: General settings
description: Manage your account, language, application version, and network proxy.
icon: gear
---

General settings control the signed-in account, interface language, network proxy, and application version.

## Open General settings

1. Open the Eigent dashboard.
2. Select **Settings**.
3. Select **General**.

> **Screenshot placeholder:** Add a screenshot of General settings with Profile, Language, and Network Proxy sections visible. Hide the full email address if required.

## Manage the account

The Profile section shows the current account.

- Select **Manage** to open Eigent account management.
- Select **Log out** to clear active task state, reset local installation state, and return to login.

Save or finish important work before logging out.

## Change the language

1. Open the Language selector.
2. Choose a language or **System default**.

Current interface languages include:

- English
- Simplified Chinese
- Traditional Chinese
- Japanese
- Arabic
- French
- German
- Russian
- Spanish
- Korean
- Italian

Some third-party tool output and generated content can remain in another language.

## Configure a network proxy

1. Enter the proxy URL in **Network Proxy**.
2. Select **Save**.
3. Select **Restart to apply**.

Supported schemes:

- `http://`
- `https://`
- `socks4://`
- `socks5://`

Example:

```text
http://127.0.0.1:8080
```

Clear the field and save to remove the proxy.

## Review updates

The Settings sidebar shows the installed version. When an update is available, select the update action to start the package download.

Self-hosted development builds should update through Git and the repository build process instead.

> **Video placeholder:** Add a 45-second MP4 showing language change, proxy save and restart, and the version or update control. Include captions.

## Troubleshooting

### Proxy URL is rejected

Include a supported scheme and valid host. Credentials, when required, must use valid URL encoding.

### Network changes do not apply

Restart Eigent after saving or removing the proxy.

### Language changes only part of the interface

Restart the application and report missing translation keys with the current version and locale.

## Related guides

- [Appearance](/settings/appearance)
- [Privacy](/settings/privacy)
- [Self-hosting](/get_started/self-hosting)
