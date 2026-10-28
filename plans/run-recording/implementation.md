# Implementation and validation plan

Status: Draft work packages. This branch authorizes Markdown planning only; runtime implementation, dependency changes and publishing are subsequent work.

## 0. Prove the capture path

Use installed Electron 33.4.11 and the actual Eigent window with embedded browser preview. Avoid assuming the newest documentation matches the packaged runtime.

- Prototype both capture routes in the architecture: OS window capture and own frame subscription. Compare consent requirements, embedded-browser composition, frame cadence and CPU, including the cost of copying subscribed frames from main to the worker, then pick one. Also try `WebFrameMain` capture through `setDisplayMediaRequestHandler`.
- Resolve the owned source; restrict the dedicated session's media handler to its authorized worker/source.
- Capture through a hidden main-owned worker with no React timer dependency. Configure it with `backgroundThrottling: false` and confirm cadence holds while the worker and main window are hidden or backgrounded.
- Prove a headless-initiated start after an explicit desktop grant, including the capture API's user-activation requirements. `getDisplayMedia` requires user activation; test `getUserMedia` with `chromeMediaSource: 'desktop'` as the fallback. A React click must not become a permanent prerequisite; do not bypass permission protections to satisfy this test.
- Probe `video/mp4;codecs=avc1` first, then WebM codecs, on every supported platform. Record real bytes, stop, inspect the container and verify playback and seeking in an external player. For WebM, prove the duration and Cues rewrite at finalization. Decide the native format and whether any separate MP4 export route is still needed.
- Measure file size at the proposed bitrate and confirm the 60-minute clip roll and per-Space budget values.
- Exercise resize/high DPI, embedded WebContentsView composition, cursor, moving/minimizing/backgrounding, Mac lock/unlock, sleep/wake, source closure and permission denial/revocation.
- Run a 60-minute soak alongside an agent task. Measure frame cadence, CPU, memory, spool growth, disk limits and impact on agent execution.
- Test development and packaged/signed macOS; document Windows and Linux supported capture behavior.
- Record the H.264 licensing position for MP4 output, including Chromium's native `avc1` MediaRecorder path.
- If an encoder is needed, specify packaged availability, provenance/version, licensing and failure behavior. A developer's installed `ffmpeg` is not release evidence. Do not add an SDK or upgrade Electron by assumption.

Exit evidence: playable clip, media inspection, resource measurements and a platform matrix recording actual outcomes. Technical implementation choices are Draft until this proof exists.

## 1. Headless domain and API

Proposed additions: `backend/app/recording/{models,service,store,provider}.py` and `backend/app/controller/recording_controller.py`, registered through existing router/startup composition.

Implement the scoped catalog, idempotent lifecycle and API in [architecture.md](architecture.md). Discover providers dynamically rather than interpreting `EIGENT_RUNTIME=electron` as proof of capture availability. Use an injectable provider and a separate versioned recording event stream; do not accidentally require a new Run-journal schema from all clients.

Exit checks:

- Direct API start, status and stop with a fake provider and no React or Electron.
- Unavailable provider while a normal Task runs.
- Authorization and ownership checks.
- Grant issue, expiry on every listed event, revocation during capture, and rejection of OS permission or Full access mode as a substitute.
- A headless start without a live grant returns `permission_required` and creates no recording; only a desktop start enters `awaiting_permission`.
- Idle expiry or per-start confirmation for headless starts, if the security review adopts one.
- `source_busy` on a second start, including a start for a different Run.
- Resume after pause produces a new clip tagged with the new Attempt; a Run with no Attempt records the clip with `attempt_id` absent.
- Duplicate requests and callbacks; terminal states and restart reconciliation.

Do not add mandatory recording methods to every generic Hands implementation.

## 2. Electron adapter and command transport

Proposed additions: `electron/main/recording/` and a bundled recorder document/preload under `electron/recording/`. Wire backend readiness, adapter attachment and shutdown through existing Electron bootstrap.

Register from main, receive leased authenticated commands over the SSE command stream and acknowledge them by POST, resolve only owned sources and own the capture worker. Implement bounded chunk delivery/writes and validate sender, frame, sequence, size and recording generation. Keep paths and credentials out of worker-facing IPC. Heartbeat availability separately from actual frame progress. Dispose tracks/workers/spool leases on every stop, source loss, quit and disconnect.

Exit checks: forged-sender/stale-lease tests, SSE disconnect and reconnect without duplicate streams, backpressure/disk-full, real Electron capture/playback, and a headless API command controlling the connected adapter after the Session page unmounts. Renderer state must not own recording lifetime.

## 3. Space-folder publication and catalog

Resolve bound Space storage through the workspace resolver. Reserve destinations, validate/hash final media, publish atomically and derive the manifest from the catalog. Honor workspace mutation ownership; never select an agent's isolated worktree as the persistent recording folder.

Add the narrow managed-media policy described in the architecture, with dedicated tests. Reserve the destination in the catalog at recording start, and have `_artifact_path_filter` and `_artifact_upload_policy` in `backend/app/artifacts.py` consult catalog-reserved paths. Preserve ordinary video files, tracked content and existing ignore files. Captures remain local-only. A completed Run's immutable artifact manifest remains unchanged when a late clip is published.

Exit checks:

- Clips and metadata survive reload/backend restart in the selected Space folder.
- Space/account switches do not redirect recording ownership or publication.
- Unbind/rebind, root replacement, symlinks and pre-existing destinations cannot overwrite or publish into another root.
- Recovery covers crashes before/after rename and before catalog commit without duplicates or false readiness.
- A late clip appears in catalog-backed listings/Space Files without reopening Run history.
- Ordinary MP4/WebM files remain content; tracked recording files remain tracked.
- Scratch/folder Space captures are not automatically uploaded or pulled into agent checkpoints through generic output discovery.
- Regression: in a Brain-owned scratch Space, a clip published while the Run's mutation window is open is absent from the Run artifact manifest and the upload lane. Run this test before the policy change to confirm it fails today.
- A user-created `recordings/` folder with ordinary videos is still discovered as content.
- Recording folder names contain no backend terms; `run_id` and `attempt_id` appear only in the manifest and catalog.

## 4. Thin controls and playback

Proposed additions: `src/service/recordingApi.ts`, a typed optional host recording slice, `src/hooks/useRecording.ts`, a Session-owned start control and an app-wide recording indicator in the top bar. Choose final filenames after inspecting the nearest surface at implementation time.

UI sends backend commands and renders backend state. It does not own a MediaRecorder, recording timer, write destination or finalization. Desktop source/permission interaction is capability-injected through `useHost()`, like local-folder selection. Web/CLI deployments retain normal behavior and receive truthful unavailable capability rather than browser-native capture as an implicit fallback.

Reuse existing Session header and Files/video preview with `Button`, `DsText`, `DsIcon`, tooltip/dialog recipes. Preserve technical Project keys while using Space/Session/Task copy. No generated token edits or new design exception are planned.

Exit evidence: actual light/dark Electron states for available, recording, stopping, finalizing, completed, denied, interrupted and unavailable; keyboard, narrow/short panes, localization, 200% zoom and reduced motion. The top-bar indicator is visible and can stop capture from Settings, another Session and the Space Files view, including for a recording started by a headless client. The consent dialog states what is captured. No visible string uses "Run". Mock tests do not establish OS capture or media playability.

## 5. Rolling buffer and selected clips

Add **Save last 30 seconds** only after ordinary clips work. Use independently decodable segments or a proved encoder-backed extraction path, with initialization data, keyframes, timestamps and bounded retention by time/bytes. Clamp selection to actual available footage.

Retain segment leases for overlapping exports until publication completes. Tests cover saves during capture/after source loss, less than 30 seconds available, simultaneous saves, eviction, disk-full, restart and cleanup. Independently inspect a timed visual fixture to prove the selected interval was saved and can play/seek from its beginning. Arbitrary recent-chunk concatenation is not accepted. Add event bookmarks after this works.

## Acceptance scenario

1. Connect a local folder as a Space and start a Task normally.
2. Authorize silent recording of the correct Eigent window and start capture.
3. Navigate away from the Session page; main-owned capture continues while its source is available, and the top-bar indicator stays visible on every page.
4. Stop through a headless API client; returning UI shows the same authoritative state.
   With the Session page absent, start another clip through the API under a still-valid grant and verify actual frame progress, not only command acceptance. The top-bar indicator appears for this headless start.
   Start a third recording while one is active and confirm `source_busy`.
5. Open the clip from Space Files and an external player. Check duration, actual dimensions/cadence, playback and seeking.
6. Complete a Task while capture finalizes. Task completion succeeds; late media uses the recording catalog and preserves Run history.
7. Restart the backend/app; final media, metadata and ownership survive.
8. Run normally without Electron; recording returns unavailable and the Task still succeeds.
9. Lock/unlock and revoke permission; verify supported continuation or truthful interruption, resource release and recovery.
10. Repeat steps 1–6 in a scratch Space and confirm no clip enters the Run artifact manifest or upload lane.

## Validation and release evidence

For this planning change: scoped Markdown formatting, relative-link validation, `git diff --check` and commit scope. Runtime/UI tests are not evidence for unimplemented recording code.

For implementation, add and run focused backend tests at proposed paths:

```bash
cd backend
.venv/bin/python -m pytest tests/app/recording tests/app/controller/test_recording_controller.py
ruff check app/recording app/controller/recording_controller.py tests/app/recording
ruff format --check app/recording app/controller/recording_controller.py tests/app/recording
```

Those suites are work to add, not existing tests. Also extend workspace/artifact and auth tests wherever contracts change.

```bash
npm run type-check
npm run check:design-tokens
npx vitest run <recording-host-api-state-and-ui-tests>
npx eslint <changed-TypeScript-files>
npx prettier --check <changed-files>
git diff --check
```

Electron fixtures must inspect actual media, correct sources, sender ownership, stop/disposal and platform behavior. Headless tests run without Electron imports or a React client. Release evidence includes the codec/packaging decision and phase-zero platform matrix.

## Decisions requiring technical proof

| Decision         | Proposed direction                                               | Required evidence                                                                            |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| First target     | Owned Eigent window only                                         | Correct identity and embedded-browser composition                                            |
| Capture route    | OS window capture or own frame subscription                      | Consent requirements, composition, cadence and CPU for both prototypes                       |
| Worker           | Hidden Electron-owned recorder                                   | Works without React lifecycle; known lock/background outcomes                                |
| Format/export    | Native MediaRecorder MP4 if available; otherwise seekable WebM   | Actual container, playback, seeking, packaged availability, H.264 licensing and measurements |
| Command channel  | SSE commands with POST acknowledgments; long polling as fallback | Disconnect detection, reconnect without duplicates, lease expiry                             |
| Managed media    | Catalog-authorized untracked capture paths; tracked content wins | Mutation, checkpoint and upload regression tests                                             |
| Recovery budgets | Independent bounded finalization and renewable leases            | Soak, crash, disconnect and disk-full tests                                                  |

The headless product boundary and Electron-only adapter scope are decided. These remaining details require technical validation, not a change to that boundary or automatic authorization to install new dependencies.
