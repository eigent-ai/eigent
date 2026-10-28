# Recording fixtures

Run from the repository root with frontend dependencies installed and the backend virtual environment prepared.

```sh
npm run test:recording
node test/e2e/recording/verify-ui.mjs
npx vitest run --config vitest.config.ts test/recording test/unit/components/Session/HeaderBox.test.tsx
npm run type-check
cd backend
.venv/bin/python -m pytest tests/app/recording tests/app/controller/test_recording_controller.py tests/app/controller/test_task_controller.py -q
```

`test:recording` launches a dedicated Electron window and isolated loopback Brain fixture with temporary storage and credentials. It uses the production adapter/worker/controller/service, synthetic application and embedded-view content, and mocked native consent. It records across document navigation, stops through the headless API, rejects a competing start, then starts and stops a second clip with the existing live grant. It does not access an existing user's desktop pixels, workspace, or account. The runner cleans up its processes and prints its evidence directory.

If ffprobe and ffmpeg are installed, the runner also checks the silent video profile and externally decodes/seeks each clip. They are optional test tools, not application dependencies. Native MP4 capture and safe directory-handle publication must be available on the host; macOS development is the validated platform.

`verify-ui.mjs` requires installed Google Chrome. It renders the actual recording controls in a Vite component fixture with injected state and saves light/dark screenshots for seven lifecycle/result states, keyboard focus, a narrow viewport, and 200% zoom with reduced motion. It checks browser errors and horizontal overflow. This does not replace full-app or signed-build acceptance testing.

See [implementation and remaining release checks](../../../docs/recording.md).
