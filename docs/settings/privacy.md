---
title: Privacy
description: Understand Eigent's privacy controls and data-handling boundaries.
icon: fingerprint
---

Eigent can process prompts, files, credentials, browser sessions, and external service data. Where that data goes depends on the selected model, deployment mode, Space type, and connectors.

This page provides a practical privacy checklist. Review the current privacy policy and source code for deployment-specific guarantees.

## Understand model data flow

### Eigent Cloud

Prompts and relevant context are sent through Eigent's managed model service.

### Bring Your Own Key

Prompts and relevant context are sent to the configured provider endpoint using your credentials.

### Local models

Model requests are sent to the configured local endpoint. Data can remain on infrastructure you control when all other tools and services are also local.

<Note>
A local model does not make the entire workflow local if the task also uses cloud connectors, search, remote MCP servers, or external browser services.
</Note>

## Understand file storage

- Local-folder Spaces can let agents read and modify the selected directory.
- Blank Spaces store generated artifacts in Eigent-managed project storage.
- Uploaded files become task context.
- Generated outputs can remain in project or workspace folders.

Limit each Space to the files required for its work.

## Protect credentials

Credentials can include:

- Model API keys
- MCP environment variables
- OAuth grants
- Search credentials
- Browser cookies
- Remote-control links

Use restricted credentials, rotate exposed values, and remove unused configurations.

## Manage browser sessions

Browser cookies can grant access to external accounts.

- Use a dedicated automation profile.
- Delete unused cookie domains.
- Avoid privileged sessions.
- Restart after changing cookie state.

## Share tasks and remote links safely

Before sharing:

- Review prompts and generated outputs.
- Remove personal or confidential data.
- Confirm the active Space and Project.
- Stop remote-control sessions after use.

## Delete data

Eigent provides deletion or removal actions for:

- Tasks
- Projects
- Some Space records
- Model providers
- Connectors and MCP servers
- Browser cookies
- Remote-control sessions

Deletion in Eigent does not automatically revoke data or credentials stored by an external provider.

**Screenshot placeholder:** Add a privacy-oriented composite screenshot showing provider removal, connector removal, cookie deletion, and project deletion confirmations. Do not include real data.

**Video placeholder:** Add a 60-second privacy walkthrough covering local versus cloud models, Space file boundaries, credential removal, and browser-cookie cleanup. Include captions.

## Open-source deployments

Self-hosting gives you control over the application and infrastructure, but you remain responsible for:

- Network security
- Database access
- Secret storage
- Logs and backups
- User permissions
- Provider configuration
- Update and vulnerability management

## Related guides

- [Self-hosting](/get_started/self-hosting)
- [Provider reference](/models/provider-reference)
- [Custom MCP servers](/connectors/custom-mcp)
- [Browser cookies](/browser/cookies)
