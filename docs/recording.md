# Session recording

Implementation of the first-release clip workflow in [PR #2063](https://github.com/eigent-ai/eigent/pull/2063). The optional rolling buffer and “Save last 30 seconds” phase are not implemented.

## User workflow

In a Session with an active Task, choose **Record** and approve the native consent dialog. The source is Eigent's own content, including its visible embedded browser views. There is no audio, desktop capture, or capture of other applications. Recording continues when navigating to another Session or Settings. The app-wide indicator shows state, elapsed time, and **Stop recording**. Finished clips open in the existing Files preview from the Session's recordings menu.

Stopping, pausing, or ending a Task ends its capture. Resuming a Task does not silently restart recording. Lock, suspend, minimize, account changes, permission revocation, renderer failure, and an expired provider lease also stop capture. The stopped clip may finish publication independently of Task completion.

## Ownership and authorization

Brain owns the SQLite catalog, state transitions, durable events, immutable Run/attempt/Space binding, quotas, and publication. The catalog is `recordings.sqlite3` beside the Run journal. React only sends commands and projects versioned state. Electron main owns the optional capture adapter and its isolated worker; navigation does not own the capture lifetime.

Public routes use the existing local-control principal authentication. A separate main-process bootstrap credential authorizes provider registration and consent grants. The provider receives an ephemeral generation/token and renewable 15-second command lease. These credentials and spool paths are not exposed to React or capture-worker code. Native consent grants expire after 15 idle minutes and are revoked on adapter replacement. A previously authorized headless client can discover its available grants through capabilities; it cannot manufacture consent.

## Public API

Paths are relative to the existing Brain API root. Backend `project_id` identifies the Session and `run_id` retains the existing execution identifier.

| Method | Route                      | Purpose                                                                  |
| ------ | -------------------------- | ------------------------------------------------------------------------ |
| GET    | `/recordings/capabilities` | Availability, supported formats, and the principal's live capture grants |
| POST   | `/recordings`              | Start with `run_id`, `grant_id`, and `idempotency_key`                   |
| GET    | `/recordings`              | Latest 200 records; optional `space_id`, `project_id`, `run_id` filters  |
| GET    | `/recordings/{id}`         | Current state and published clips                                        |
| POST   | `/recordings/{id}/stop`    | Idempotent stop                                                          |
| GET    | `/recordings/events`       | Versioned SSE; replay using `after` or `Last-Event-ID`                   |

Only one capture can be active. A competing start returns `source_busy`; missing consent returns `permission_required`; an absent provider or encoder reports unavailable without creating a recording. Recording state is separate from Task state: `starting`, `recording`, `stopping`, `finalizing`, then `completed`, `interrupted`, `failed`, or `denied`.

## Media and storage

The adapter probes native H.264/MP4 support before advertising availability. Own-web-contents frames and owned child views are composited into a silent canvas recording at up to 1920×1080, 24 fps, and 2.5 Mbps. There is no runtime ffmpeg dependency or Electron upgrade. A runtime without native MP4 support is unavailable; no WebM conversion fallback is included.

Each clip has a one-hour limit. A live Task with the same attempt and valid consent can continue into a new recording directory after that limit. A Space has a 5 GiB recording budget and a 256 MiB free-space floor. Chunks are bounded to 8 MiB, the worker queue to 16 MiB, and finalization to 60 seconds. The adapter and Brain both enforce limits; stopped frame delivery cannot be concealed by command heartbeats.

Clips publish under the immutable Space root:

```text
recordings/<timestamp>_<opaque-id>/
  clip_001.mp4
  manifest.json
```

Brain checks MP4 structure and hashes, copies through directory handles with no symlink traversal, and publishes without replacing existing user files. The manifest records scope, timing, dimensions, size, and hash. Publication and managed-source snapshot capture share the Space filesystem lock.

Catalog-reserved media is local-only and excluded from automatic artifact upload and untracked workspace snapshots, including the interval before any bytes exist. Ordinary videos and unrelated files are unaffected. Explicitly Git-tracked content preserves the existing checkpoint contract. A late recording does not rewrite an already-completed Run's artifact manifest.

On restart, complete media with a matching publication manifest can finish catalog recovery. Other orphaned active records become interrupted. Partial encoder output is not remuxed or automatically resumed, and missing manifests are not reconstructed. Recovery never restores consent or starts capture.

## Verification and remaining release checks

The repeatable fixture is documented in [the recording test README](../test/e2e/recording/README.md). macOS development testing used Electron 33.4.11 / Chromium 130.0.6723.191 and produced two playable H.264 clips across navigation and a later headless start. Native consent is mocked only by the dedicated fixture; fixture pixels are synthetic. External ffprobe/ffmpeg decoding and seeking passed.

Windows currently reports `secure_publication_unavailable` because this implementation requires POSIX directory-handle publication. Linux is not validated. Signed/packaged macOS, manual native-consent acceptance, full authenticated product navigation, a real one-hour soak, and H.264 distribution/licensing review remain release checks. The one-hour rollover is covered by simulated-clock service tests. The browser screenshots exercise real production controls in a component fixture, not the complete signed application.

UI reuses `Button` (`ghost`/`secondary`, `sm`, `text`/`icon-only`), `DsIcon`, `DsText` (`meta`), `TooltipSimple` (`instant`), `DropdownMenu`, the existing Session header, and Files preview. It uses `gap-ds-control-gap`, `text-ds-ink-default-default`, and `text-ds-ink-muted-default`. No shared token changes or design exceptions were introduced. Verified fixture states: starting, recording, stopping, finalizing, completed, denied, and interrupted in light/dark themes; keyboard Stop, narrow 360×240 layout, 200% zoom, and reduced motion. Locale parity covers all 11 locales.

Focused backend/frontend tests, TypeScript checking, Ruff, focused ESLint, locale checks, design-token checks, Vite production build, and whitespace validation passed during implementation. Full-repository tests, packaged installer builds, and release signing were not run.
