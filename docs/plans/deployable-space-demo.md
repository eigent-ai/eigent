# Deployable Space demo plan

Status: in progress

Branch: `fix/deployable-space-demo`

## Product goal

Demonstrate a simpler Eigent product model in which a Space is the product a
creator configures and deploys, each Session is a durable long-running agent,
and Tasks are the concrete units of work performed by that Session.

The demo should make the primary flow feel like:

1. Open a Space.
2. Configure what the Space knows, can access, and is allowed to do.
3. Review the persistent Sessions that work inside it.
4. Preview the user experience.
5. Deploy a version of the Space.

There should be no separate Settings destination in the demo. Configuration is
owned by the Space detail surface.

## Product and terminology decisions

### Visible hierarchy

Keep the established product hierarchy:

`Space -> Session -> Task`

- **Space** is the product and deployment boundary. It owns shared identity,
  context, memory, capabilities, permissions, runtime requirements, and the
  published Space profile.
- **Session** is an existing durable Project presented as a persistent agent.
  It keeps its name, history, model selection, Tasks, and Automations over
  time.
- **Task** remains an individual piece of work with status, activity, approval,
  and output.

Preserve all backend `Project`, `project_id`, `projectId`, `new-project`, route,
event, API, database, and persisted-key contracts. Presentation components and
visible copy continue to use Session.

### Session versus profile agent

Do not rename `WorkspaceConfigurationDocument.spec.agents` to Sessions. Those
records describe internal workforce or sub-agent roles in a Space profile;
they are not the durable Project-backed Sessions shown in the product.

For the demo:

- Existing Projects are the persistent Sessions.
- Space profile model, instruction, permission, context, skill, connector, and
  environment settings define the defaults and capabilities Sessions inherit.
- Existing `spec.agents` stays under an advanced **Sub-agents** or **Workforce**
  section. It must not be presented as the Session collection.

This prevents the demo from creating a visual alias that the runtime cannot
honour.

### Meaning of deploy in the demo

Use the existing versioned Workspace Bundle review and publishing flow as the
deployment mechanism. In this phase, **Deploy Space** means publishing an
immutable, installable version of the Space profile. It does not yet claim to
provision an always-on hosted runtime or public product URL.

The UI must distinguish:

- local autosave of the editable Space configuration;
- a published/deployed immutable version;
- unpublished changes after the last deployment;
- previewing or opening the current Space runtime.

Do not store a simulated deployment status only in renderer memory. Derive it
from the saved draft and verified published-revision data. If the existing
responses cannot determine “deployed” versus “changes available,” add the
smallest read-only status contract rather than guessing.

## Target information architecture

### Home

Home remains the entry point and Space directory. Remove the Settings groups
from its sidebar so the primary navigation is focused on Spaces and product
work rather than platform configuration.

### Space detail

Keep the current Space profile layout and history-style tab navigation as the
base. The Space detail becomes the creator/admin surface with these tabs:

1. **Sessions** — persistent agents backed by Projects.
2. **Tasks** — work across the Space.
3. **Automations** — scheduled and event-triggered work.
4. **Context** — Space files and sources.
5. **Memory** — Space or selected Session memory.
6. **Configuration** — the Space profile and deployment controls.

Retain the technical URL value `spaceTab=workspace-profile` for compatibility
in the first pass, but change the visible label from “Space settings” to
“Configuration.” Add a typed route helper so future links do not hand-build
this query string.

The Space header should show:

- Space name and description;
- runtime/location status;
- Session, Task, and Automation counts;
- deployment state: Draft, Deployed, Changes available, or Needs attention;
- one primary action for the current state: **Deploy Space** or **Deploy
  update**;
- a secondary **Open Space** action for entering the existing runtime.

Opening or inspecting a Space detail must not silently activate that Space.
Only **Open Space** changes the active working Space.

### Configuration inside Space detail

Evolve the existing `WorkspaceConfigurationEditor` rather than creating a
second form system. Reorganize its current fields into a product-oriented
sequence while keeping the Workspace Bundle document unchanged:

1. **Product** — profile name, Space description, approval mode, and current
   deployment version/state.
2. **Session defaults** — default model profile and instruction policy inherited
   by new Sessions.
3. **Knowledge** — context declarations and memory scope.
4. **Capabilities** — assigned skills, connector requirements, and MCP servers.
5. **Runtime** — environment variables, Git behaviour, and remote policy.
6. **Advanced** — model profiles and internal sub-agent/workforce definitions.

Keep the current sticky section navigation, scroll-spy behaviour, autosave,
save-error recovery, resource editor panel, and navigation guard. The demo can
simplify the section labels and grouping without replacing the underlying
editor or publish pipeline.

### Product preview

Treat the existing Workspace as the initial product runtime: it is where users
interact with a Session, submit Tasks, review activity, and see outputs. Add a
**Preview product** action only if it can open this runtime without changing
the active Space; otherwise use **Open Space** and clearly label it as a state
change.

The first demo does not need a separate customer-facing web application. A
future phase can introduce a deployment URL and a reduced end-user shell after
the creator flow is validated.

## Removing the Settings page

“Remove Settings” means removing it as a first-class page and navigation
destination, not deleting reusable provider, skill, connector, browser, or
account components before their entry points have replacements.

### Destination mapping

| Previous destination         | New destination                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| Models                       | Active/browsed Space -> Configuration -> Session defaults or Advanced models               |
| Sub-agents                   | Space -> Configuration -> Advanced workforce                                               |
| Skills                       | Space -> Configuration -> Capabilities -> Skills                                           |
| Connectors                   | Space -> Configuration -> Capabilities -> Connectors                                       |
| Memory                       | Space -> Memory                                                                            |
| Channels                     | Space -> Configuration -> Capabilities, labelled account-level where still global          |
| Browser, extensions, cookies | Space -> Configuration -> Runtime, labelled device-level where still global                |
| General settings             | Contextual User menu controls or Space -> Configuration -> Product, depending on ownership |

Models, installed skills, authenticated connectors, channels, and browser data
currently have global, account, or device ownership. Moving their controls
into the Space detail must not silently change that storage scope. Use a
contextual drawer/dialog or embedded library with an explicit **Account** or
**This device** label, while the Space profile stores only its references and
requirements.

### Compatibility routing

- Replace the Settings route bridge with a Space-configuration navigation
  adapter.
- Update every `openSettings(...)` call site to a typed destination mapping.
- `/settings`, `/setting`, `/setting/*`, and existing
  `/home?section=settings&tab=...` links should redirect to the corresponding
  active Space tab/section.
- If no active Space exists, route to Home and present a create/select Space
  action. Do not choose or activate an arbitrary Space.
- Preserve the workspace-configuration save guard before any route change.
- Keep one release of compatibility redirects so saved links and desktop menu
  commands do not become dead ends.

After all call sites and tests use the new adapter, remove the obsolete
Settings navigation state and page-only orchestration. Reusable Settings UI
components may remain in their current directory until a later mechanical
move; directory cleanup is not required for the demo.

## Implementation workstreams

### 1. Route and shell foundation

Primary files:

- `src/routers/index.tsx`
- `src/routers/WorkspaceSettingsRouteLayout.tsx`
- `src/pages/Settings.tsx`
- `src/components/Layout/index.tsx`
- `src/components/Layout/AppCommandProvider.tsx`
- `src/store/settingsStore.ts`
- `src/lib/shellRoutes.ts`

Work:

- Rename/refactor the combined `SettingsPageRoute` responsibility into a Home
  and Space-detail route without changing the retained Workspace mounting
  behaviour.
- Preserve `WorkspaceSettingsRouteLayout`; it keeps Workspace drafts and
  browser/webview state mounted while moving between Workspace and Home.
- Introduce a single typed Space-detail URL builder accepting `spaceId`, tab,
  and optional configuration section.
- Replace Settings command handling and route bridging with the destination
  mapping above.
- Keep the top bar, window drag regions, updater UI, window controls, Support,
  and User menu intact.

### 2. Home and Space-detail navigation

Primary files:

- `src/components/Settings/SettingsSidebar.tsx`
- `src/components/Settings/settingsNavigation.ts`
- `src/components/Home/SpaceDetailSidebar.tsx`
- `src/components/Home/SpaceDetailTabsNav.tsx`
- `src/components/Home/SpaceDetail.tsx`
- `src/components/TopBar/index.tsx`
- `src/components/TopBar/UserMenu.tsx`
- `src/components/SpaceSidebar/index.tsx`
- `src/components/SpaceSidebar/SpaceSwitchDropdown.tsx`

Work:

- Remove Settings groups and the Settings destination from the demo sidebar
  and User menu.
- Preserve the selectable Space list, rename/delete actions, and independent
  browse-versus-activate behaviour.
- Change the visible profile tab label to Configuration while preserving its
  compatibility key.
- Add deployment status and deploy/update actions to the Space detail header or
  the top of Configuration without creating two competing primary actions.
- Keep the tab list keyboard model, focus handling, reduced-motion behaviour,
  and sticky content rail.

### 3. Product-oriented Space configuration

Primary files:

- `src/pages/WorkspaceConfiguration.tsx`
- `src/hooks/useWorkspaceConfiguration.ts`
- `src/components/WorkspaceConfiguration/WorkspaceResourceEditorPanel.tsx`
- `src/components/WorkspaceConfiguration/WorkspaceResourceListItem.tsx`
- `src/components/WorkspaceConfiguration/WorkspaceBundleSaveDialog.tsx`
- `src/service/workspaceConfigurationApi.ts`
- `src/service/workspaceBundleAuthoringApi.ts`

Work:

- Reuse the current editor, draft version, autosave queue, stale-load guard,
  flush-before-navigation behaviour, resource pickers, review, asset preflight,
  and immutable publish verification.
- Reorder and relabel presentation sections around Product, Session defaults,
  Knowledge, Capabilities, Runtime, and Advanced.
- Replace the icon-only “Share Space profile” action with a clear deployment
  status/action treatment.
- Adapt the existing publish dialog copy to **Deploy Space** while keeping the
  technical Workspace Bundle and API names unchanged.
- Show the verified version/handle after deployment and expose Copy. Do not
  claim a public live URL unless one is returned by a real deployment service.
- After a published version changes locally, show **Changes available** and
  make **Deploy update** the next action.

### 4. Persistent Session presentation

Primary files:

- `src/components/Home/Projects.tsx`
- `src/components/Home/components/HomeHubListItem.tsx`
- `src/components/Home/components/HomeHubListTable.tsx`
- `src/components/Home/hooks/useSpaceDetailData.ts`
- `src/store/spaceStore.ts`
- `src/store/projectStore.ts`

Work:

- Keep Projects as the data source but present them as durable Sessions.
- Make each row communicate agent-like continuity with name, active/completed
  state, last activity, Task count, Automation count, and selected model where
  available.
- Keep rename, archive/delete, and open actions attached to the existing
  Project contracts.
- Add a purposeful empty state: create the first Session and describe it as the
  persistent worker for this Space.
- Do not invent “running in cloud,” schedule, or memory status when those facts
  are not available from current runtime data.

### 5. Replace old Settings entry points

Audit and update at least these known consumers:

- `src/components/ChatBox/BottomBox/ModelAndThinkingEffortSelect.tsx`
- `src/components/ChatBox/BottomBox/PickerPanel.tsx`
- `src/components/ChatBox/index.tsx`
- `src/components/Workspace/index.tsx`
- `src/components/AddWorker/ToolSelect.tsx`
- `src/components/WorkspaceBundle/WorkspaceBundleInstallWizard.tsx`
- Electron application-menu command handling and keyboard shortcuts.

Each entry point must land at the relevant Space configuration section, retain
the originating route for Back behaviour, and preserve any provider/resource
target through URL state until the destination consumes it.

### 6. Copy and localization

- Add or update English source copy first, using sentence case and the exact
  Space, Session, and Task terminology.
- Keep existing translation keys containing `project` when only their visible
  values need to change.
- Add keys for Deployment, Draft, Deployed, Changes available, Deploy Space,
  Deploy update, Configuration, Session defaults, Account, and This device.
- Update every locale with placeholder parity; do not rely on fallback English
  for the demo.
- Search visible “Project,” “Workspace settings,” and standalone “Settings”
  copy separately from frozen technical identifiers.

## Design-system implementation contract

Reuse existing patterns and primitives:

- `ContentHeader` and `ContentBreadcrumb` for the persistent header;
- `SpaceDetailTabsNav` for Space-level navigation;
- `Button`, `SplitButton` if a fixed deploy action needs related choices,
  `Input`, `Textarea`, `Select`, `Switch`, `Dialog`, `DsText`, and `DsIcon`;
- `SettingsRowGroup` and the current Workspace configuration row/list recipes;
- `SidebarShell`, `SidebarScrollArea`, `SidebarNavGroup`, and `NavTab` where a
  sidebar remains;
- `scrollbar-always-visible` on the actual persistent overflow owner.

Use semantic Neutral, Ink, Accent, Hairline, feedback, focus-ring, radius, and
elevation roles. Do not introduce raw colors, stock shadows, arbitrary control
geometry, local icon sizing, or a new component namespace. No new design-token
exception is expected for this demo.

Required UI states:

- initial loading and skeleton;
- no Space selected;
- no Sessions;
- populated Space;
- autosaving and saved;
- save needs attention and retry;
- local draft;
- deploying;
- deployed;
- local changes after deployment;
- deploy failure and retry;
- missing connector/environment requirement;
- disabled action with an accessible explanation;
- long names, localized copy, and overflow.

Verify light and dark themes, keyboard navigation, visible focus, 200% zoom,
narrow and short windows, coarse-pointer targets, and reduced motion.

## Test plan

### Focused unit/component coverage

- Space detail tabs expose Configuration while preserving the compatibility
  key and ARIA tab/panel linkage.
- Browsing a Space detail does not activate it; Open Space does.
- Settings compatibility URLs and desktop commands map to the correct Space
  and configuration section.
- No-active-Space compatibility routes return to Home rather than choosing a
  Space.
- Provider, skill, connector, memory, browser, and general entry points retain
  their target and scope.
- Workspace configuration autosave, queued edits, save failure/retry, and
  navigation flush continue to work.
- Deployment status comes from verified persisted/published data.
- Publish success, recovery of an already-published revision, warnings,
  requirements, asset limits, and publish failure remain covered.
- Session lists continue to use Project IDs and existing actions.
- Locale source copy contains no stale visible Project wording and has matching
  placeholders.

Start with these existing suites and extend them rather than replacing them:

```bash
npx vitest run \
  test/unit/components/SpaceDetailTabsNav.test.tsx \
  test/unit/components/WorkspaceConfiguration/WorkspaceConfigurationEditor.test.tsx \
  test/unit/components/Layout/SettingsRouteBridge.test.tsx \
  test/unit/components/Layout/AppCommandProvider.test.tsx \
  test/unit/components/TopBar/UserMenu.test.tsx \
  test/unit/components/SpaceSwitchDropdown.test.tsx \
  test/unit/routers/LegacyRouteCompatibility.test.tsx
```

Rename test files when production responsibilities are renamed; do not leave
new behaviour described as Settings-only compatibility.

### Repository gates

```bash
npm run type-check
npm run check:i18n
npm run check:design-tokens
npx eslint <changed-source-files>
npx prettier --check <changed-files>
git diff --check
```

Run `npm run build:web` after the route and lazy-import changes. Perform a real
browser/Electron walkthrough for the full create/configure/deploy/open flow;
jsdom tests do not prove routing, sticky layout, focus movement, or deployment
dialog behaviour in the shipped runtime.

## Demo acceptance criteria

1. There is no visible standalone Settings page or Settings navigation item.
2. A user can open a Space detail and reach every demo configuration control
   without leaving that Space.
3. The Space detail clearly explains that Sessions are persistent workers and
   Tasks are their work.
4. A user can edit the current Space profile, observe reliable autosave state,
   review it, and deploy a verified immutable version through the existing
   publishing boundary.
5. The UI distinguishes Draft, Deployed, Changes available, and error states.
6. Open Space enters the existing runtime and intentionally changes the active
   Space; browsing/configuring does not.
7. Old Settings links and commands land on an equivalent Space-owned
   destination or on a clear choose/create-Space state.
8. Global and device-owned resources are labelled truthfully even though their
   controls are reached from Space configuration.
9. Visible terminology is consistently Space, Session, and Task; frozen
   Project and Workspace Bundle contracts remain unchanged.
10. Focused tests, type checking, locale parity, design-token checks, scoped
    lint/format, diff checks, the web build, and an Electron/browser walkthrough
    pass or are reported explicitly as not run.

## Out of scope for this demo

- Provisioning an always-on cloud computer for every Session.
- A public hosted product URL or custom domain.
- Billing, metering, marketplace purchase, or multi-tenant customer
  administration.
- Migrating globally stored provider credentials, installed skills, browser
  sessions, cookies, or channels to true Space ownership.
- Renaming backend Project or Workspace Bundle models and serialized values.
- A second visual workflow builder or node canvas.
- Automatic multi-Session coordination beyond behaviour already supported by
  the runtime.

These are follow-on product/backend phases after the interaction model is
validated by the demo.
