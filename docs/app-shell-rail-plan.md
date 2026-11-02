# App shell rail plan

> **Status: proposal.** This plan adds an icon rail to the left of the app,
> gives Home, each pinned Space and Settings their own place on it, and turns
> Home into the place where people start and find Sessions across all Spaces.
> Nothing here is implemented yet.

## 1. Goal

Today the app has two pages and one combined management page: the Space page
(`/`), and Home with Settings inside it (`/home`). People move between them
with the Home pill and the Space switcher in the top bar. We want to:

1. Give the app a small number of fixed places that are always one click away.
2. Let people start a Session without first choosing or learning a workspace.
3. Let people who keep working in one Space keep it on screen, with its Files,
   Dispatch, Automations and Sessions.
4. Show at a glance which Spaces have running work or are waiting for a reply.
5. Move Settings out of Home so each page has one job.

## 2. Terms

UI copy follows `docs/product-terminology.md`: **Space → Session → Task**.
Backend identifiers (`projectId`, `project_id`, `Project`) stay unchanged.

| Term           | Meaning                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| Top bar        | The window bar. Window buttons, sidebar toggle, layout controls and utilities   |
| Rail           | The icon-only column on the far left. It chooses which place is shown           |
| Sidebar        | The 240px column next to the rail. It is the table of contents for that place   |
| Home           | The overview of all Spaces and their Sessions, from the user's point of view    |
| Pinned Space   | A Space the user added to the rail                                              |
| Space view     | The working view of one pinned Space: Files, Dispatch, Automations and Sessions |
| Space overview | One Space's details inside Home: Sessions, Tasks, Automations, Context, Memory… |
| Settings       | App-wide setup: models, connectors, skills, sub-agents, memory and general      |

## 3. Current layout

- `src/components/Layout/index.tsx` renders the `TopBar` above every page.
  `src/components/Layout/AppShellLayout.tsx` renders a fixed 240px sidebar and
  the content pane below it.
- `src/components/TopBar/TopBarPrimaryNavigation.tsx` aligns the top-bar
  controls to the sidebar edge. The left group holds the sidebar toggle and the
  Home pill. The right group holds the Space switcher (`SpaceSwitchDropdown`).
- `/` is the Space page. `SpaceSidebar` shows Workspace (Sessions), Files,
  Automations and Dispatch for the active Space.
- `/home` (`src/pages/Settings.tsx`) is Home and Settings in one page with one
  sidebar. `?section=spaces` lists Spaces. `?spaceId=…&spaceTab=…` shows one
  Space's details (Sessions, Tasks, Automations, Context, Memory, Profile).
  `?section=settings&tab=…` shows a Settings section. `/settings` and older
  routes redirect here.
- Features open Settings with `openSettings(section)`. `SettingsRouteBridge`
  turns that request into a `/home?section=settings…` navigation.
- `WorkspaceSettingsRouteLayout` keeps the Space page mounted while Home is
  open, so drafts and live previews survive the switch.
- `spaceStore.projectsBySpaceId` keeps the Session list for every Space on the
  device, so Home can list Sessions without opening each Space.
- The app has one active Space at a time (`activeSpaceId`). Opening a Session
  in another Space makes that Space active
  (`projectStore.setActiveSpaceAndProject`).

## 4. Options considered

| Option                   | Rail                                       | Result                                                                                       |
| ------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| A. Rail of views + pins  | Home, Space, pinned Spaces, Settings       | The Space icon and the current pin lead to the same view. Two icons for one place            |
| **B. Rail of places**    | **Home, pinned Spaces, Settings**          | **Chosen.** Every icon is one place. Pinning is how a Space gets a workspace                 |
| C. Today's layout + pins | No rail. Pins live in the top-bar switcher | Smallest change, but Settings stays inside Home and other Spaces' status stays in a dropdown |

## 5. Layout

### 5.1 Overall frame

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ● ● ●  [sidebar]  [panes]          top bar          [update] [?]     │
├────┬───────────────┬─────────────────────────────────────────────────┤
│ ⌂  │ sidebar       │ content                                         │
│────│ (table of     │                                                 │
│ R● │  contents for │                                                 │
│ M● │  the place    │                                                 │
│    │  chosen on    │                                                 │
│    │  the rail)    │                                                 │
│ ⚙  │               │                                                 │
└────┴───────────────┴─────────────────────────────────────────────────┘
 rail
```

- **Top bar**: window buttons (macOS traffic lights, or the Windows controls on
  the right), sidebar toggle, layout controls such as split panes, Update and
  Support. It no longer holds the Home pill or the Space switcher.
- **Rail**: 48px wide. Home at the top, then pinned Spaces, then Settings at
  the bottom. It stays visible when the sidebar is folded.
- **Sidebar**: the existing 240px column. Its content depends on the rail.
- **Content**: the existing content pane.

### 5.2 Rail

- **Home**: icon button. Opens Home.
- **Pinned Spaces**: one 24px tile per Space (Space icon or first letter), in
  the order the user set. A dot shows status: running, or waiting for the
  user's reply. Hover shows the Space name. Right-click offers Unpin, Rename
  and Space settings.
- **Settings**: icon button at the bottom. The account menu can sit with it.
- Keyboard: ⌘1 for Home and ⌘2–⌘9 for pinned Spaces in order.
- Every rail button has an accessible name and uses `DsIcon` at the `main`
  recipe. Selected state is not shown by color alone.

### 5.3 Home

Home is where people start. Its sidebar lists every Space with its recent
Sessions:

```text
┌───────────────────┐
│ + New session     │
│                   │
│ Research  pinned  │   ← click the name: Space overview
│   Weekly report  ●│   ← click a Session: open it here
│   Competitor scan │
│ Marketing pinned  │
│   Draft launch  ● │
│ Ops               │
│   Vendor invoices │
│   Show all 4      │
│ + New Space       │
└───────────────────┘
```

The content area shows one of:

1. **New session**: the composer, with a Space picker. It defaults to the last
   Space the user worked in.
2. **A Session**: the chat for that Session, without the Space sidebar. Its
   own preview panel still works.
3. **Space overview**: today's Space details (Sessions, Tasks, Automations,
   Context, Memory, Profile), with two actions: **Pin to rail** and **Open
   workspace**.

Sidebar rules:

- Show 3–5 recent Sessions per Space, then "Show all".
- Remember which Spaces are folded.
- Spaces with running or waiting Sessions sort first; the rest sort by last
  activity.
- Pinned Spaces still appear here, marked as pinned.

### 5.4 Space view

Choosing a pinned Space on the rail opens its Space view. This is today's Space
page: the sidebar shows Files, Dispatch, Automations and the Space's Sessions,
and the content shows the Session or the chosen tool. Split panes and the
layout controls in the top bar belong to this view.

### 5.5 Settings

Settings becomes its own place again. Its sidebar is today's Settings group:
Models, Sub-agents, Connectors, Skills, Channels, Memory, the browser
sections, Cookies and general settings. Space-specific settings stay in the Space overview.

## 6. Behaviour rules

1. **Every Session has a Space.** New session from Home always shows which
   Space it goes into, because the Space decides the folder the agent works in.
2. **Opening a Session can change the active Space.** Opening a Session from
   another Space in Home makes that Space active, with its folder and file
   previews. This is how the app already works.
3. **Pinning is how a Space gets a workspace.** Pin to rail adds the Space to
   the rail and opens its Space view. Unpin removes it from the rail only; the
   Space and its Sessions are not touched.
4. **Open workspace without pinning.** Open workspace from the Space overview
   shows a faded, temporary tile on the rail for as long as the Space view is
   open. Leaving removes it unless the user pins it.
5. **Keep state when switching places.** Switching between Home, a Space view
   and Settings keeps drafts, scroll position and live previews, as
   `WorkspaceSettingsRouteLayout` does today for Home.
6. **Only the active Space is loaded.** Other pinned Spaces are shortcuts with a
   status dot, not live copies.

## 7. Routes and state

| Place          | Route                               | Notes                                  |
| -------------- | ----------------------------------- | -------------------------------------- |
| Home           | `/home`                             | New session or the last opened Session |
| Space overview | `/home?spaceId=<id>&spaceTab=<tab>` | Same parameters as today               |
| Space view     | `/` (active Space)                  | Unchanged                              |
| Settings       | `/settings?tab=<section>`           | Becomes a real page again              |

- `/home?section=settings&tab=…` and the existing legacy routes redirect to
  `/settings?tab=…`.
- `SettingsRouteBridge` navigates to `/settings?tab=…` so every
  `openSettings(section)` call keeps working.
- Pinned Spaces are stored as an ordered list of Space IDs in the persisted
  Space store. A Space that is deleted or no longer available drops out of the
  list.

## 8. Design system notes

- Rail buttons are icon-only `Button` controls with tooltips, using `DsIcon`
  `main`. No new primitive unless the Space tile needs one.
- The rail width and the top-bar alignment are AppShell measurements. Register
  them in `src/style/tokens/exception.registry.json` next to the existing
  sidebar width instead of repeating raw values.
- `TopBarPrimaryNavigation` currently lines its controls up with the 240px
  sidebar. It has to account for the rail.
- Width budget: on a 1280px window, the 48px rail plus the 240px sidebar
  leaves about 990px for the content. Fold the sidebar by default when two or
  more panes are open.
- Respect reduced motion for the sidebar fold and place switches. Check light
  and dark themes, 200% zoom, long Space names and localization.

## 9. Open questions

1. **Where does a pinned Space's Session open when clicked in Home?**
   Recommendation: it opens in Home, where it was clicked. The rail tile is the
   way into the Space view. The alternative is to jump to the Space view, which
   moves the user without asking.
2. **Status dots for Spaces that are not active.** The Session list for every
   Space is on the device, but live running or waiting status may only be known
   for the active Space. Check this before the dots ship, and fall back to the
   last known status.
3. **Do pins follow the account across devices?** Start with device-only pins.
4. **The web build.** Confirm the rail works the same in the browser build and
   at narrow widths.

## 10. Delivery

Land after the split view work (#2069, #2071), because both change the top
bar and the Space page.

| PR  | Title                                             | Depends on |
| --- | ------------------------------------------------- | ---------- |
| 1   | `feat: add an icon rail with Home and Settings`   | Split view |
| 2   | `feat: pin Spaces to the rail`                    | 1          |
| 3   | `feat: list every Space and its Sessions in Home` | 1          |
| 4   | `feat: open a Space workspace without pinning`    | 2, 3       |

PR 1 moves Settings to `/settings`, adds the rail and removes the Home pill
from the top bar. The Space switcher stays in the top bar until PR 2 replaces
it with pins.

## 11. Testing

- Unit tests for the pinned list: order, pin, unpin, a deleted Space, and the
  ⌘1–⌘9 mapping.
- Route tests for every legacy redirect and for `openSettings(section)`.
- Component tests for the Home sidebar: folding, "Show all", sorting, and
  opening a Session from another Space.
- Manual checks: switch Home → Space view → Settings while a Task is running
  and a draft is typed; nothing is lost. Check macOS and Windows window
  controls, light and dark themes, 200% zoom and reduced motion.
