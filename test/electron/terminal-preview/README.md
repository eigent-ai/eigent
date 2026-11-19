# Terminal preview Electron verification

This isolated macOS fixture loads the production Summary process rows, preview
panel, browser guest layer, terminal components, chat links, and theme provider.
It uses the production Electron PTY IPC handlers and backend TerminalToolkit,
process registry, and authenticated process routes. It runs real shell commands
and HTTP servers. Only model dispatch, workspace admission, and the surrounding
application shell are replaced with fixtures; no account or model call is needed.

Prerequisites: repository Node dependencies and the backend virtual environment.
Run from the repository root. Ports 18740–18743 must be available.

## Build and run

Build the Electron entry points:

```sh
node - <<'JS'
const esbuild = require('esbuild');
(async () => {
  for (const entry of ['main', 'preload']) {
    await esbuild.build({
      entryPoints: [`test/electron/terminal-preview/${entry}.ts`],
      bundle: true, platform: 'node', format: 'cjs', packages: 'external',
      outfile: `test/electron/terminal-preview/.build/${entry}.cjs`,
    });
  }
})();
JS
```

Start these two fixture servers in separate terminals:

```sh
./node_modules/.bin/vite --config test/electron/terminal-preview/vite.config.ts
```

```sh
backend/.venv/bin/python -B test/electron/terminal-preview/backend.py
```

Then run the verification:

```sh
node test/electron/terminal-preview/verify.mjs
node test/electron/terminal-preview/verify-layout.mjs
```

Restart the fixture backend before repeating `verify.mjs`, because completed
process records intentionally survive view switches. Close both fixture servers
with Ctrl+C after verification. Electron closes its own PTYs on exit; the backend
cleans up its own toolkits. All command working directories and Electron profiles
are temporary. Screenshots and JSON results are written under `.artifacts/` and
are ignored by git, together with `.build/`.

## Coverage boundaries

- The main run checks real xterm screen retention across five Session round trips,
  resizing while away, literal percent signs and partial prompts, live blocking
  output, Unicode, server/terminal rows, chat links, tab reuse, the four-option
  chooser, process exit statuses, Stop isolation, closed server ports, retained
  output, dark theme, and reduced motion.
- The layout run checks keyboard Stop, a long label, an empty Session, a narrow
  and short window, and 200% Electron zoom.
- This is production-component Electron integration on macOS. It does not claim
  a packaged application run, Windows verification, a paid agent task, or new
  server persistence across backend/application restarts. Existing protected
  execution and Run cleanup policies remain in force.
