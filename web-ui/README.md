# Eigent Web UI

`web-ui` is the remote access interface for the Eigent desktop app. It is designed as an extension of the desktop frontend, not as a separate product UI. The desktop app remains the source of truth for the design system, shared UI primitives, stores, task/chat behavior, theme tokens, and visual language.

The current version focuses on the frontend UI, routing, layout, and mock data flow. Backend and server integration will be completed separately.

## Goals

- Reuse the desktop app frontend design system and components wherever possible.
- Provide a web entry point for controlling desktop projects remotely.
- Keep the visible experience aligned with the desktop app so web, desktop, and future extension surfaces feel like the same product.
- Prepare the structure for production auth, remote project history, task input/output, and remote control actions.
- Keep the web-specific code small: routing, layout composition, web auth handling, mock adapters, and remote-access view models.

## Relationship To Desktop Frontend

The desktop app frontend under `../src` is intentionally used as the source of truth. `web-ui` imports desktop modules through the root `@` alias for shared pieces such as:

- UI primitives from `@/components/ui/*`
- design tokens and theme providers
- auth and project stores
- chat store adapters
- chat message rendering
- model and session mode helpers
- workflow agent definitions
- shared API utilities

This avoids duplicating the desktop design system in the web app. If a component or token already exists in desktop frontend code, prefer reusing it instead of rebuilding a web-only version.

Use `@web/*` for web-specific code and `@/*` only for source-of-truth desktop/shared frontend code.

## Folder Structure

```text
web-ui/
  index.html                 Vite HTML entry for the web UI
  vite.config.ts             Web UI Vite config and dev proxy setup
  vitest.config.ts           Test config scoped to web-ui
  src/
    main.tsx                 Browser entry; mounts shared providers and web routes
    App.tsx                  React Query, execution subscription, routes, toaster
    routes.tsx               Web route tree
    styles.css               Web-only global layout styles
    api/
      server.ts              Website/backend API adapter for auth, user, projects
      brain.ts               Brain/task API adapter for task execution and control
    components/
      auth/                  Web auth route guard
      dispatch/              Main remote project/task workspace UI
      layout/                Web app shell and toaster
      profile/               Web profile/settings screens using desktop stores/tokens
      project/               Earlier project/session detail components
      projects/              Shared project list presentation
    hooks/
      useProjects.ts         Loads and filters project list view models
      useProjectDetail.ts    Loads project detail and side-panel data
      useSpaces.ts           Current web space/workspace state
      useWebAuth.ts          Web auth/logout/media-query helpers
      useWebProjectTask.ts   Bridges web project data into desktop project/chat stores
      useWebTaskChatSend.ts  Web task message send flow using desktop chat logic
    lib/
      authTokens.ts          Refresh token storage and login response parsing
      mockMode.ts            `VITE_WEB_UI_MOCK` detection
      projectSearch.ts       Project search/filter helpers
      viewModels.ts          Backend history-to-web view model mapping
      webMockAgentResponse.ts Mock agent response injection
      webTaskMessages.ts     Web task message display/loading rules
    mock/
      auth.ts                Mock auth bootstrap into desktop auth store
      data.ts                Mock users, billing, projects, providers
      handlers.ts            Mock API and SSE behavior
      http.ts                Mock replacement for desktop `@/api/http`
      state.ts               Mutable mock project/profile state
    pages/
      DispatchPage.tsx       Active project/task workspace route
      LoginPage.tsx          Website login and local/mock login flow
      ProfilePage.tsx        Legacy/simple profile page shell
      ProjectDetailPage.tsx  Earlier project detail route implementation
      ProjectsPage.tsx       Earlier project list route implementation
    types/
      index.ts               Web-facing project, session, account, panel types
  test/
    integration/             Route and interaction tests
    unit/                    Pure helper and component tests
```

## Active UI Flow

The active route tree is in `src/routes.tsx`.

- `/login` renders `LoginPage`.
- Protected routes use `ProtectedRoute`.
- `/` redirects to `/projects`.
- `/projects` renders the dispatch workspace without an active task panel.
- `/projects/:projectId` renders the dispatch workspace with the selected project/task panel.
- `/profile/*` renders the web profile/settings sections.

`DispatchPage` is the main remote-control workspace. It composes:

- `ProjectPanel` for project search, project selection, new task creation, and project settings.
- `TaskPanelHeader` for the active space/project header.
- `TaskChatView` for preparing the selected project and showing `WebTaskChatBox`.
- `WebTaskChatBox` for chat input and task messages.
- `WebTaskMessageList` for rendering user and agent messages using desktop chat message components.

`ProjectsPage`, `ProjectDetailPage`, and `components/project/*` are earlier project/session screens. They are still useful as reference or fallback structure, but the current primary web UI is the dispatch route.

## Data Logic

The web UI uses lightweight web-facing types from `src/types/index.ts`:

- `WebProject`
- `WebSession`
- `WebSpace`
- `UserAccount`
- `UserProfile`
- `BillingSummary`
- `SessionSidePanelData`

Backend project history data is converted into these view models in `src/lib/viewModels.ts`. Search and sorting are handled in `src/lib/projectSearch.ts`.

The main project data hooks are:

- `useProjects`: fetches grouped project history, maps it to `WebProject[]`, sorts by activity, and filters by search text.
- `useProjectDetail`: fetches one grouped project and maps it to a `WebProject`.
- `useSessionPanel`: fetches task steps, snapshots, and files for the side panel.
- `useWebProjectTask`: prepares the desktop `projectStore` and active chat store for the selected web project.
- `useWebTaskChatSend`: sends user messages through the desktop chat/task logic and handles mock responses in mock mode.

The important design choice is that web project data is adapted into the existing desktop project/chat store shape. This lets the remote UI reuse desktop chat behavior instead of creating a separate web-only task engine.

## Mock Mode

Mock mode is enabled with:

```bash
VITE_WEB_UI_MOCK=true npm run dev:web-ui
```

When mock mode is enabled:

- `vite.config.ts` aliases `@/api/http` to `web-ui/src/mock/http.ts`.
- `mockBootstrapAuth` seeds the desktop auth store with a mock user.
- `mock/state.ts` owns mutable in-memory project/profile state.
- `mock/handlers.ts` simulates API responses and SSE-like task events.
- `useWebTaskChatSend` injects mock agent replies after user input.

Mock mode exists to build and review the UI before backend integration is complete. It should mirror expected production response shapes closely enough that backend adapters can replace it without changing page/component structure.

## Auth Flow

The web UI uses the desktop `useAuthStore` as the frontend auth source of truth.

Current auth paths:

- Mock mode: `mockBootstrapAuth` writes mock user/session data into `useAuthStore`.
- Dev local mode: `autoLoginLocal` calls `/api/v1/user/auto-login`.
- Website login: `loginWithPassword` calls `/api/v1/user/login`.
- Session restore: `refreshAccessToken` reads the refresh token from local storage and calls `/api/v1/user/refresh`.
- Logout: `logoutWeb` clears the web refresh token and calls the desktop auth store logout action.

Refresh tokens are stored by `src/lib/authTokens.ts` under:

```text
eigent_web_refresh_token
```

Production auth should keep returning the current expected login shape:

```ts
{
  access_token: string;
  refresh_token: string;
  token_type?: string;
  email: string;
}
```

## Backend Integration Points

`src/api/server.ts` is the website/server API adapter. It currently defines:

- `loginWithPassword`
- `refreshAccessToken`
- `logoutWeb`
- `fetchCurrentUser`
- `updateUserProfile`
- `fetchBillingSummary`
- `fetchGroupedProjects`
- `fetchProjectGroup`
- `renameProject`
- `deleteHistory`
- `fetchChatSteps`
- `fetchChatSnapshots`
- `autoLoginLocal`

`src/api/brain.ts` is the brain/task API adapter. It currently defines:

- `sendProjectMessage`
- `controlTask`
- `fetchProjectFiles`
- `uploadFileToBrain`

The backend/server handoff should preserve these adapter functions as the boundary between UI and data. Page and component code should not call raw endpoints directly.

## Environment Variables

Relevant variables used by the current web UI:

```text
VITE_WEB_UI_MOCK=true        Enable mock API/auth/task behavior
VITE_PROXY_URL=...           Proxy `/api` requests in Vite dev server
VITE_USE_LOCAL_PROXY=true    Use local auto-login mode on the login page
VITE_CLOUD_API_URL=...       Cloud API URL sent when starting brain tasks
```

The Vite config reads env files from the repository root so the web UI can share project-level environment settings.

## Commands

Run the web UI in development:

```bash
npm run dev:web-ui
```

Build the web UI:

```bash
npm run build:web-ui
```

Preview the built web UI:

```bash
npm run preview:web-ui
```

Run web UI tests:

```bash
npm run test:web-ui
```

## Future Surfaces

This structure is intended to support additional remote-access surfaces, including a future Chrome extension. The recommended direction is:

- Keep desktop frontend as the design-system and behavior source of truth.
- Keep `web-ui/src/api/*` as replaceable transport adapters.
- Keep web/extension-specific routing, shell layout, auth bootstrap, and permissions code outside desktop source.
- Share view models and mock fixtures where they match production response contracts.
- Avoid duplicating desktop UI components unless the surface has a real platform-specific constraint.

## Current Ownership Boundary

Frontend-owned in this version:

- web route structure
- dispatch workspace layout
- responsive project/task panels
- profile/settings web layout
- mock auth and mock project/task state
- web view models and search helpers
- tests for current UI behavior

Backend/server-owned next:

- production website auth/session integration
- remote project history APIs
- task execution and SSE transport contracts
- remote task pause/resume/stop behavior
- project files, snapshots, and steps data
- deployment and access control for remote web sessions
