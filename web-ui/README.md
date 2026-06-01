# Eigent Web UI

`web-ui` is a standalone browser frontend for Eigent remote access. It lives in
this repository for now, but its source boundary is intentionally independent
from the desktop frontend.

## Boundary

- `@web/*` and `@/*` both resolve to `web-ui/src/*` inside this project.
- `web-ui` must not import `../src`, `@desktop/*`, desktop stores, desktop host
  bridges, desktop chat stores, or desktop UI components.
- Shared visual language is vendored into `web-ui/src`: design tokens, UI
  primitives, theme provider, auth store, API adapters, and public assets.
- The root package still provides the dependency install, Vite, Tailwind, and
  Docker build scripts during this transition.

## Entries

- `index.html` mounts the authenticated web app.
- `remote.html` mounts the public `/remote-control/:sessionId` link surface.

## Commands

```bash
npm run dev:web-ui
npm run build:web-ui
npm run test:web-ui
```

## Important Files

- `web-ui/vite.config.ts`: web-only Vite config. The `@` alias points to
  `web-ui/src`.
- `web-ui/src/styles.css`: web-only Tailwind and token stylesheet.
- `web-ui/src/components/ui/*`: web-owned UI primitives.
- `web-ui/src/components/Layout/ThemeProvider.tsx`: web-owned theme runtime.
- `web-ui/src/store/authStore.ts`: web-owned auth and profile settings store.
- `web-ui/src/api/http.ts`: web-owned HTTP/SSE adapter.
- `web-ui/src/pages/RemoteControlPage.tsx`: public remote-control page.

## Verification

Before merging web-ui changes, run:

```bash
npm run test:web-ui
npm run build:web-ui
npm run check:remote-tokens
rg -n "@desktop|../src|@/components/ChatBox|@/store/projectStore|@/store/chatStore" web-ui/src web-ui/test web-ui/vite.config.ts web-ui/vitest.config.ts
```

The last command should return no source dependency hits.
