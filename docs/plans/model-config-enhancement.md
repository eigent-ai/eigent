# Model configuration enhancement

Branch: `feat/model-config-enhancement`, based on local `main`.

Status: production implementation of the selected **Collections** layout with
**Register-style configuration dialogs**. The three prototype variants and
their HTML entry point have been removed.

## Confirmed design

- Models is a direct Settings destination. The existing production navigation
  already has this structure; Sub-agents remains a separate setting.
- Eigent is the first provider collection. Its Manage dialog controls which
  built-in models appear in Settings and the input menu, on this device only.
- Only configured custom/local providers appear in the page. Add model opens
  the searchable catalog; a provider may be selected repeatedly.
- Each saved configuration binds one model to its own key, endpoint, and
  provider-specific options. Add and Edit open a dialog, never an inline form.
- Settings rows and model selectors show only the model name. Provider
  collections and menu headings supply the provider context; saved record IDs
  remain the internal identity when duplicate model names exist.
- The input trigger shows the model and muted thinking-effort label. One model
  list is grouped by provider; there are no Cloud / Custom / Local submenus.
- Thinking effort stays in the input box. No effort field or persisted effort
  preference is added to model configuration. Conflicting effort keys entered
  in advanced JSON are rejected.

## Implementation boundaries

### Data and identity

The existing Provider API already supports multiple records and CRUD by ID.
`src/lib/configuredModels.ts` loads paginated records without collapsing by
provider name and applies a default using the exact saved ID. No database or
API schema change is included.

`useConfiguredModels` provides the shared inventory behavior for Settings and
the input menu. Refreshes are triggered by configuration changes and window
focus; stale responses and account changes cannot repopulate another account's
inventory. Credentials remain in memory, not in presentation preference storage.

`modelVisibilityStore` persists only account-scoped hidden Eigent catalog IDs.
The source cloud catalog and its entitlement/retirement handling are unchanged.
Hidden models remain identifiable on Sessions that already selected them.

### Editing

Dialogs preserve API host/key fields, optional local credentials, Azure and
Bedrock fields, JSON model parameters, remote model discovery, manual entry,
and local model discovery. Remote discovery uses the existing backend proxy.
Discovery results are transient and invalidated when credentials or endpoint
change, rather than shared across a provider's different keys.

Validation runs before persistence. Add uses POST; Edit uses PUT on the selected
ID. Edit checks the current record and preference before saving. New records do
not become the default implicitly. Failures keep the dialog open.

The existing llama.cpp health-check exception is retained. Codex subscription
keeps its desktop OAuth flow and one connected-account model; multiple OAuth
accounts are outside this API-key configuration redesign.

### Defaults, removal, and Sessions

The active default cannot be hidden, deleted, or disconnected until another
default is selected. Removal has a confirmation dialog and affects only the
chosen Provider record.

Selecting with a `projectId` updates only that Session's captured model.
Selecting from the new-Session input changes the global default. Existing
read-only/disabled input contexts are preserved. Thinking-effort changes do not
change the selected model or its credentials.

Runtime lookup and worker lookup load all provider pages. A missing pinned
configuration stops startup with an actionable error instead of silently using
another key. Editing an existing record changes future resolutions of that ID;
already-running requests are not modified.

### Navigation and copy

Existing `provider=<catalog ID>` Settings links open a fresh configuration
dialog for that provider. Model error messages now point to Settings → Models.
New UI copy is present in all eleven locales, preserving translation keys and
technical Project/Provider identifiers.

## Design-system application

Reused SettingsSectionPage and SettingsContentShell ownership; Button,
DialogContent/DialogHeader, Input, Textarea, Select, ProviderModelCombobox,
Switch, DropdownMenu, DsText, DsIcon, and existing provider images.

Axes: primary Save/Add provider; secondary Cancel/Manage/Add model; ghost small
row actions; error-tone removal; default-size fields; medium dimmed dialogs.
Colors and layout use semantic Neutral, Ink, Accent, Hairline, panel radii,
spacing, and shared scrollbar recipes. Shared Button, Dialog, and Switch changes
are limited to reduced-motion handling and dialog exit polish. No generated
tokens changed. Menu width uses the existing Radix collision geometry exception;
no new exception was added.

## Validation and limits

- Focused tests cover repeated provider records, exact-ID create/edit/delete,
  defaults, frontend visibility, local optional keys, invalid JSON, stale and
  failed discovery, deep links, Session pins, and independent thinking effort.
- Visual checks use the actual production components with isolated mock data:
  light/dark, provider collections, modal add/save, grouped input menu, and a
  640 × 480 short/narrow window with a scrolling form and fixed actions.
- The normal `npm run dev:web` app remains on port 5173. Its in-app browser is
  signed out, so authenticated live CRUD, real provider credentials, and desktop
  Codex OAuth have not been exercised. No auth bypass was added.
- The temporary mock-data review harness is removed after verification.
- Optional human-readable configuration labels, picker search, billing details
  inside the model-management dialog, and capability-specific effort filtering
  from the earlier exploratory plan are not part of this implementation.
  Existing account/billing surfaces and runtime effort behavior remain in place.
