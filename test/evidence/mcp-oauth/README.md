# Remote MCP OAuth validation

Captured on 14 October 2026 from the implementation on `feat/remote-mcp-oauth`.

The screenshots render the actual `McpOAuthControls` and `McpConnectorNotice`
components with the shipped theme provider and CSS. The account, connector
statuses, broker replies, and browser-flow replies are synthetic fixtures.
They are automated visual evidence, not human verification or proof of a live
Astrocade login.

- [Light theme](light.png): keyboard focus, sign-in required, connected,
  unavailable keyring, and the Task sign-in action.
- [Dark theme](dark.png): the same states using the dark Eigent theme.
- Additional browser checks exercised pending/cancel states, German copy,
  a 560px viewport at 200% zoom, and scrolling. There were no browser script
  errors or horizontal overflow in the fixture.

Primitives: `Button` (`secondary`/`ghost`, `sm`), `Tag` (`secondary`, `default`
emphasis; success/warning/error/information tones), `DsText` (`base`/`meta`),
and the existing connector `Switch`. No design exception was added.

Automated validation:

- 67 frontend tests across connectors, MCP OAuth, workspace secrets, and
  existing subscription authentication.
- 76 backend tests across MCP OAuth, worker tools, toolkit rollback, global
  resources, workspace secrets, and pinned environments. Includes a real
  CAMEL connection that lists and calls a tool on a local MCP server using
  the injected bearer token.
- Type checking, renderer/Electron main/preload build, design-token checks,
  locale parity for all 11 locales, focused ESLint, Ruff, and diff checks.
- Live unauthenticated Astrocade probe confirmed its 401 challenge, protected
  resource, authorization endpoints, registration endpoint, and S256 support.

Full `npm run lint` encounters existing generated `dist-web` assets outside
this change. Focused lint on changed source and tests passes.

Before release, a human still needs to approve an actual Astrocade login,
check tool use across restart and real token expiry, and verify a packaged
Linux AppImage with a usable keyring and with keyring storage unavailable.
Tokens remain device-local and refresh before connection; mid-Task refresh
and providers requiring manual client registration remain outside this scope.
