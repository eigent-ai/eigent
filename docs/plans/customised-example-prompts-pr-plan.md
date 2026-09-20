# Personalised example content: PR plan

## Objective and scope

Show relevant example Tasks on Workspace and Automation by matching the user's work role with the current Space category. Author content in the website repository, publish it to S3, and deliver validated recommendations through an Eigent API.

For v1, "user profile" means one selected work role, and "Space profile" means one selected category. Matching does not inspect free-text profiles, files, Memory, conversation history, or Workspace Bundle configuration.

Selecting an example prepares an editable draft. Running a Task or saving an Automation requires a separate user action.

## PR ownership and dependencies

| PR  | Scope                                                                                      | Owner                                                    |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 1   | Space category schema and API                                                              | Backend engineer                                         |
| 2   | User-role persistence and compatible profile updates                                       | Backend engineer                                         |
| 3   | Website catalog schema, content, and S3 publishing                                         | Website/content engineer                                 |
| 4   | Retrieval API, desktop client, shared recommendation component, fixtures, and feature flag | Application engineer; designer supplies component design |
| 5   | Role onboarding/settings, Space-category controls, and Automation examples                 | Designer/UI engineer                                     |
| 6   | Workspace examples                                                                         | Workspace engineer                                       |

Confirm named owners before work starts, especially the additional user-profile work in PR 2 and the application infrastructure in PR 4.

Agree on the shared contracts below first. PRs 1–3 can then progress in parallel. PR 4 can begin against fixtures while those PRs are developed. PRs 5 and 6 each consume PR 4 and can be developed independently; Workspace must not import shared infrastructure from the Automation feature.

Integration and rollout are a shared release checklist, not a seventh implementation PR. Each PR owns its relevant tests and compatibility checks.

## Shared contracts to agree before implementation

### Profile values and ownership

Use stable keys for storage and matching; translate display labels separately.

| Field                | Allowed values                                                                                                    | Owner   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ------- |
| User `work_role_key` | `engineering`, `design`, `product`, `marketing`, `finance`, `legal`, `security`, `operations`, `other`, or `null` | Product |
| Space `category_key` | Any enabled category key declared by the content catalog, or `null`                                               | Content |

- `null` means no selection; existing records remain `null`.
- `other` is an explicit work-role choice.
- Space category keys are lowercase slugs of at most 50 characters. They start with a letter and may contain lowercase letters, numbers, and single hyphen-separated segments, for example `engineering`, `customer-success`, or `revenue-operations`.
- The Space database and profile API validate only this stable key format. They do not contain a category enum or validate catalog membership.
- The content catalog is the source of truth for which Space categories are available for selection, their translated labels, and their ordering. Adding a valid category must not require a server migration or desktop release.
- If the catalog declares `general`, it is an explicit Space category, not a wildcard.
- Catalog `["*"]` means applicable to any value, including a missing selection.
- Do not persist `"*"` on a user or Space or invent a `general` user role.
- Each catalog tag array must contain either one or more valid concrete keys or `["*"]`. Empty arrays and mixed wildcard/concrete arrays are invalid.
- V1 supports one role per user and one category per Space. Catalog entries may target several roles or categories.
- Profile updates preserve omitted fields; explicit `null` clears the selected field.
- New readers tolerate absent fields from older servers. Existing clients omitting the new fields must preserve saved values.
- A disabled or removed catalog category does not erase the stored Space value. It is unavailable for new selection and receives wildcard recommendations unless a current catalog entry still targets it. The UI must let the user clear or replace it.
- Category values affect recommendations only. They are never authorization, entitlement, or execution settings.

### Matching and ordering

First filter by surface and enabled state. Resolve one translation per example ID using the requested supported locale, then `en-US`. Title, summary, and prompt use the same resolved translation. Use the app's existing locale normalization.

Then assign each eligible example to its best matching tier:

1. Concrete role match and concrete category match.
2. Wildcard role and concrete category match.
3. Concrete role match and wildcard category.
4. Wildcard role and wildcard category.

A missing profile value cannot match a concrete tag. A conflicting concrete tag is ineligible even if the other dimension matches.

Within each tier, sort by descending priority, then ascending stable ID. Remove duplicate IDs and fill remaining slots from lower tiers until the requested limit is reached. For example, one exact match plus two fallback matches returns three examples. Do not repeat examples to fill an insufficient catalog.

This category-first fallback order gives the current Space's subject priority over the user's profession. Include fixture cases for every tier, missing values, explicit `other`, a catalog-defined `general` category, dynamically added categories, disabled or removed categories, conflicting tags, ties, duplicates, and insufficient results.

### Catalog and API

The website owns the canonical versioned catalog schema. Backend and desktop consume the same contract and fixtures.

The catalog envelope contains `schema_version`, `catalog_version`, `enabled`, `space_categories`, and `items`. Each Space-category registry entry contains an immutable `key`, `enabled`, `sort_order`, and locale-keyed labels. Each item contains `id`, `enabled`, `surfaces`, `role_keys`, `space_category_keys`, `priority`, and locale-keyed translations with title, summary, and plain-text prompt. Optional translated Automation name and description are display/draft defaults only.

The publisher rejects duplicate or malformed category keys and item category tags that are neither `["*"]` nor references to enabled registry entries. Labels may change without changing stored keys. Disabling a category removes it from new selection; retain its last-known label long enough for clients to explain and clear historical selections.

Use an Eigent API for v1. S3 access and ranking live on the server; the desktop never needs AWS credentials. Proposed request:

```http
GET /api/v1/example-prompts?surface=automation&role_key=engineering&space_category_key=security&locale=en-US&limit=3
```

Omit role/category query parameters when unknown. The API validates fixed role values, validates category-key syntax, and bounds the limit. It accepts these as recommendation filters, not authorization or resource identifiers. A well-formed stored category that is absent or disabled in the current catalog cannot match a concrete item tag, but it can still receive wildcard results.

PR 4 also exposes the current content-owned category choices through the Eigent API, for example:

```http
GET /api/v1/example-prompt-options?locale=en-US
```

The options response carries `schema_version`, `catalog_version`, `status`, `source`, `expires_at`, and enabled `space_categories` with resolved labels. The desktop never reads S3 directly.

Agree on a response with:

- `schema_version` and `catalog_version`.
- `status`: `ready`, `disabled`, or `unavailable`.
- `source`: `live`, `cache`, or `none`.
- `expires_at` for the result's maximum permitted reuse.
- `items`: ID, title, summary, prompt, resolved locale, and optional Automation defaults.

`ready` may have an empty item list; that is an authoritative result. `disabled` always has no items. `unavailable` means neither live content nor an eligible cached result is available.

Proposed initial caching defaults are a five-second upstream timeout, five-minute freshness period, and a 24-hour maximum age for last-known-good content. Confirm these before implementation.

- Only request failure may use a still-valid cached result or bundled fallback.
- A successful empty or disabled response replaces the previous result and suppresses fallback.
- A successful catalog refresh removes disabled/withdrawn entries from cache.
- Record the latest known catalog disable state per environment and respect it during outages until a successful response re-enables the feature.
- Offline clients cannot learn new withdrawals immediately; do not promise instantaneous removal. Expired remote content is discarded.
- Cache keys include API environment, surface, role, category, and locale; results carry their catalog version. Account changes clear selected drafts and derived recommendations.

## PR 1 — Space category schema and API

**Owner:** Backend engineer

**Goal:** Persist one optional content-owned category key on each Space without embedding the category taxonomy in product code.

### Todo

- [ ] Add a nullable string `category_key` database column and migration; leave existing Spaces unset and do not add a fixed-value database constraint.
- [ ] Extend `Space`, `SpaceIn`, `SpaceUpdate`, and `SpaceOut`.
- [ ] Support category reads and writes through create, update, list, and detail APIs.
- [ ] Validate only the stable lowercase-slug format and length; do not hardcode or fetch the catalog taxonomy in this PR.
- [ ] Preserve omitted fields on update and allow explicit `null` clearing.
- [ ] Test arbitrary valid content-defined keys, malformed keys, explicit clearing, old-client payloads, migration, and category persistence.
- [ ] Publish request/response fixtures for PR 4.

### Acceptance criteria

A content-defined category key survives create, update, and reload. A newly published valid key requires no change to PR 1 code or database schema. Existing Spaces and clients continue to work. Space-category controls are implemented in PR 5; catalog retrieval and desktop type/API plumbing belong to PR 4.

## PR 2 — User-role persistence and compatible profile updates

**Owner:** Backend engineer

**Goal:** Persist one optional work role per account without changing unrelated profile data.

### Todo

- [ ] Add a nullable `work_role_key` database column and migration.
- [ ] Extend user-profile reads and updates; do not reuse `work_desc`, permission roles, or agent roles.
- [ ] Make role-only updates preserve fullname, nickname, work description, and other omitted fields.
- [ ] Ensure older clients updating other profile fields cannot clear the new role.
- [ ] Distinguish omitted values from explicit `null` when clearing a role.
- [ ] Validate canonical keys and retain authenticated account ownership.
- [ ] Test role-only updates, old-client updates, explicit clearing, and profile read-back.
- [ ] Publish API fixtures for PR 4.

### Acceptance criteria

The role follows the account across devices. Setting or clearing it does not erase other profile fields. Existing users remain unset until they make a selection.

**Current-code concern:** The existing profile PUT handler assigns fullname, nickname, and work description directly, and their request defaults are empty strings. Adjust those update semantics or introduce a dedicated partial-update endpoint before a role-only form uses it.

## PR 3 — Website catalog and S3 publishing

**Owner:** Website/content engineer

**Goal:** Publish validated example content independently of desktop releases.

### Todo

- [ ] Commit the shared versioned catalog schema and representative fixtures.
- [ ] Define the canonical `space_categories` registry with stable keys, enabled state, sort order, and translated labels.
- [ ] Add website content fields for audience tags, surfaces, priority, enabled state, translations, and optional Automation defaults.
- [ ] Enforce unique stable IDs and category keys, valid category-key syntax, item tags that reference the registry, supported schema versions, plain-text prompts, and agreed content-length limits.
- [ ] Write the first 12–20 concise examples, including at least three wildcard examples per surface.
- [ ] Review each entry separately for Workspace and Automation suitability.
- [ ] Keep initial examples usable with available product capabilities; avoid prompts that silently require unconfigured connectors or missing private inputs.
- [ ] Validate content in the website build before publishing.
- [ ] Publish immutable catalog versions to S3, then update `index.json` only after all referenced objects are available.
- [ ] Provide the object location and server access contract to the PR 4 owner.
- [ ] Support item withdrawal, catalog disablement, and rollback to a previous valid catalog.
- [ ] Support category addition, label changes, disabling, and historical-selection labels without reusing or silently renaming a published key.
- [ ] Test publisher validation and pointer/version consistency.

### Acceptance criteria

Content can be published or withdrawn without releasing the app. Website, backend, and desktop teams have the same schema and fixtures. S3 objects contain public example content, not user profile data or credentials.

## PR 4 — Shared delivery and desktop infrastructure

**Owner:** Application engineer; designer supplies shared component design

**Goal:** Provide a complete shared integration surface for both UI PRs.

### Backend todo

- [ ] Implement the example API against PR 3's catalog contract.
- [ ] Load and validate the content-owned Space-category registry and expose enabled, localised options through the Eigent API.
- [ ] Validate catalog content at runtime and apply the specified matching, ordering, deduplication, and locale rules.
- [ ] Implement timeout, refresh, maximum cache age, disablement, and withdrawal behavior.
- [ ] Return explicit ready/disabled/unavailable states with version and expiry.
- [ ] Test the matching matrix and successful empty/disabled responses versus transport failures.

### Desktop todo

- [ ] Add the fixed user-role type and an opaque Space-category key type; do not duplicate the catalog category list in desktop code.
- [ ] Add Space-category API mapping and create/update plumbing for blank and folder Spaces.
- [ ] Add a client and cache for the server-provided, localised Space-category options, scoped by API environment and catalog version.
- [ ] Load the current user's profile after sign-in and restore it on application reload.
- [ ] Scope profile state to account and API environment; clear it on logout/account/environment changes.
- [ ] Ignore pending responses belonging to a previous account or recommendation context.
- [ ] Refresh recommendations after role/category edits without restarting the app.
- [ ] Treat absent fields from older servers as unset; report unsupported preference writes without claiming they were saved.
- [ ] Add the shared example API client, recommendation hook, runtime response validation, and generic bundled examples.
- [ ] Add the shared recommendation component with loading, empty, disabled, and unavailable states, designed with the designer.
- [ ] Export a stable component/hook interface and fixtures so PRs 5 and 6 do not depend on one another.
- [ ] Add a feature flag, disabled by default, before either page integration merges.
- [ ] Ensure the flag disables example UI and requests on both surfaces.
- [ ] Define shared analytics helpers for example impressions, selection, and subsequent explicit submission/save.
- [ ] Track example ID, catalog version, and surface; do not collect prompt text, user drafts, or Space names.
- [ ] Test profile hydration, account switching, stale requests, cache expiry, and feature-off behavior.

### Acceptance criteria

Both UI teams can integrate against stable fixtures and exports. Disabled or withdrawn content is not restored by fallback handling. A failed recommendation request does not block the composer or Automation form.

The shared component uses existing primitives such as `Button`, `DsText`, `DsIcon`, and `Skeleton`, with semantic tokens and visible keyboard focus.

## PR 5 — Preference UI and Automation examples

**Owner:** Designer/UI engineer

**Dependencies:** PRs 1, 2, and 4; fixtures support earlier UI development.

### Role and Space-category todo

- [ ] Add an optional "What kind of work do you do?" role-selection step.
- [ ] Offer returning users with no role a lightweight selection entry point; do not rely solely on first-launch installation flags.
- [ ] Allow skipping/dismissing the prompt and editing or clearing the role later in Settings → General/Profile.
- [ ] Save only against the authenticated account. If selection occurs before sign-in, hold it as a pending draft and offer to save it once the account is known.
- [ ] Make failed saves retryable without blocking onboarding or losing the selection.
- [ ] Add optional Space-category selection for blank/folder Space creation and editing/clearing in Space settings.
- [ ] Render Space-category choices from PR 4's server-provided catalog options rather than a bundled enum.
- [ ] Do not require existing or imported Spaces to select a category before use.
- [ ] If a stored category is no longer enabled, show it as unavailable using the last-known label when possible and let the user clear or replace it.
- [ ] Localise labels and preserve the distinction between "Other", "General", and unset values.

### Automation todo

- [ ] Add examples and a separate "Create blank automation" action to the empty state.
- [ ] Keep examples available from the create flow after Automations exist.
- [ ] Reuse PR 4's component and hook with `surface=automation`.
- [ ] Base recommendations on the explicitly targeted Space and the current user's role.
- [ ] Prefill prompt and optional name/description; protect any existing edited form before replacement.
- [ ] Keep scheduling, timezone, and activation choices explicit.
- [ ] Selecting an example only opens/updates a local form draft; it creates no Session or Automation.
- [ ] Show the target Space and allow selection of an existing Session in that Space or a "New session" option.
- [ ] On explicit save, validate the form and target, then create the requested Session if needed before saving the Automation.
- [ ] If Session creation succeeds but Automation saving fails, retain that Session ID for retry so another Session is not created on each attempt.
- [ ] Preserve the draft on failure; handle a changed/deleted target without silently saving to another Space.
- [ ] Keep the target fixed while editing; changing it explicitly refreshes examples without overwriting the form.
- [ ] Respect PR 4's feature flag, response states, and analytics contract.
- [ ] Test zero-Session Spaces, existing targets, cancellation, save/retry, draft replacement, and Space changes.

### Acceptance criteria

A user in a new Space with zero Sessions can choose an example and explicitly save an Automation. Cancelling before save creates nothing. Example selection never starts a Task or saves/activates an Automation. Existing users can set preferences without repeating installation onboarding.

**Current-code concern:** `TriggerDialog` currently rejects submission without `activeProjectId`. Its Session target must become explicit for this flow rather than relying on whichever Session was last active.

## PR 6 — Workspace examples

**Owner:** Workspace engineer

**Dependencies:** PR 4, with profile/Space APIs from PRs 1 and 2. No dependency on PR 5's UI implementation.

### Todo

- [ ] Reuse PR 4's component and hook with `surface=workspace`.
- [ ] Show up to three compact examples beneath the Workspace composer.
- [ ] Resolve the current Space category and current user's role; unset values use the documented fallback rules.
- [ ] On selection, prefill and focus the composer while preserving attachments.
- [ ] Confirm replacement when the composer already contains a draft.
- [ ] Do not create a Session or submit a Task until the user explicitly sends.
- [ ] Refresh recommendations on role, category, Space, account, or locale changes.
- [ ] Cancel or ignore stale requests using PR 4's shared behavior.
- [ ] Respect the feature flag and cache/fallback/disablement rules; do not add independent fallback logic.
- [ ] Use the shared analytics contract and clear example attribution when the draft is replaced or its context changes.
- [ ] Verify both Workspace and New Session variants if the component is mounted in both.
- [ ] Test prefill, existing-draft protection, attachments, stale responses, disabled content, and explicit submission.

### Acceptance criteria

Examples work with unset preferences before PR 5 ships and become personalised when values are available. Clicking an example never starts work. Existing drafts remain intact until the user confirms replacement.

## Shared validation and release checklist

**Owner:** Product/release owner coordinates; each PR owner validates their changes.

- [ ] Run relevant backend migration/API tests and frontend component tests within their owning PR.
- [ ] Run type checking, focused lint/formatting, and `git diff --check` for affected code.
- [ ] Run design-token validation and locale parity checks for UI/copy changes.
- [ ] Verify keyboard navigation, visible focus, light/dark themes, 200% zoom, narrow windows, long translations, and reduced motion where applicable.
- [ ] Report reused primitives, selected semantic tokens/axes, verified states/themes, and any registered design exception in UI PR handoffs.
- [ ] Verify old clients against the new APIs and unset fields from older servers.
- [ ] Test the full matching matrix, locale fallback, unavailable catalog, explicit empty result, disabled catalog, withdrawn item, and expired cache.
- [ ] Test returning users, account switching, and preference changes without restart.
- [ ] Perform a real Electron walkthrough of Workspace prefill and Automation creation in a Space with zero Sessions.
- [ ] Deploy additive schema/API support and a validated catalog before enabling desktop integrations.
- [ ] Enable internally first; observe request failures, fallback usage, selection, and successful explicit submission/save.
- [ ] Test turning the feature off before wider rollout.
- [ ] Keep all UI integrations gated until their dependencies and acceptance criteria are satisfied.

## Product-owner immediate todo list

- [ ] Confirm the fixed role keys, Space-category slug format, content ownership of the category registry, and one-value-per-profile v1 scope.
- [ ] Assign named owners for all six PRs and confirm backend capacity for PR 2.
- [ ] Approve the wildcard/null contract, category-first fallback order, and cache defaults.
- [ ] Confirm the Eigent API delivery approach and provide the S3 publishing/access details to the relevant engineers.
- [ ] Have PRs 3 and 4 owners agree on schema, API response, and fixtures before UI integration.
- [ ] Ask the designer to deliver the shared recommendation component design early for PR 4.
- [ ] Prepare 12–20 examples and at least three wildcard examples for each surface.
- [ ] Include the zero-Session Automation save flow in the designer's handoff.
- [ ] Schedule the shared integration walkthrough and internal rollout.

## Shared implementation rules

- Use the active repository design and terminology contracts.
- Preserve public terminology as **Space → Session → Task**.
- Use **Automation** in visible copy while preserving backend `Trigger` and `Project` identifiers.
- Validate remote content and render prompts as plain text.
- Keep AWS credentials on the server/publishing side.
- Preference matching changes recommendations only; it does not change permissions, model settings, or execution behavior.
- Content publishing, schema migrations, application implementation, and rollout are separate deliverables; report their status independently.
- Treat published Space-category keys as immutable identifiers. Change labels freely, but never reuse a key for a different meaning.
