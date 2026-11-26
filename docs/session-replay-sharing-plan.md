# Session replay and sharing plan

> **Status: first version in progress.** This plan lets people replay a
> finished Session step by step, and share a read-only copy of a Session
> through a public link that opens in any browser. Replay (§4) and the desktop
> side of sharing (§5.1, §5.2) are built; §9 lists what is built and what is
> left.

## 1. Goal

1. **Replay.** Re-watch a Session the way it happened: the request, each step,
   tool call, approval and answer, with play, pause, speed and a step
   scrubber. Replay never runs anything again.
2. **Share.** Create a link to a read-only copy of a Session. Anyone with the
   link can open it in a browser without installing Eigent or signing in, and
   replay it. The owner chooses what is included, sees a preview before
   publishing, and can see and stop their links later.

## 2. Terms

UI copy follows `docs/product-terminology.md` (**Space → Session → Task**).

| Term           | Meaning                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| Replay         | Playing stored Run events into the timeline at a chosen pace, read-only |
| Shared Session | A fixed copy of selected Runs of a Session, published under a link      |
| Share link     | The public URL of one Shared Session                                    |
| Viewer         | The browser page that shows a Shared Session                            |

A Run is one request and its work. UI copy calls a Run a **Task** ("Task 1",
"Tasks still running are not included"); "Run" stays in code and API names.

## 3. What exists today

- **Task share (older flow).** `src/lib/share.ts`, used from the Home task
  menu, posts a `task_id` to `/api/v1/chat/share` and copies a link to the
  website's download page. The link only opens inside the desktop app
  (`App.tsx` share-code handler → `ChatBox` `handleSendShare`), which plays the
  Task back from `/chat/share/playback/{token}`. The self-hosted copy is in
  `server/app/domains/chat/api/share_controller.py`.
  Gaps: it covers one Task, not a Session; the recipient needs the desktop
  app; it plays the older step history, not the current timeline; the link
  lasts one day; there is no place to see or stop shared links.
- **Durable events.** Every Run's events are stored in the Run journal and can
  be read in order (`GET /runs/{run_id}/events`, `GET /runs/{run_id}/stream`).
  The event-native timeline is the default renderer and is built from these
  events.
- **Events already reach the cloud.** Run events sync to the cloud through
  the outbox, and the Remote Control web app already renders Run events in a
  browser.
- **Session recording** (screen video, draft #2063) is separate. A Shared
  Session could include a recording later; this plan does not depend on it.

## 4. Replay

Replay runs entirely on the device and needs no server change.

1. **Entry.** Session menu → **Replay**, and a replay button on each Run
   section of a finished Run. Running Runs cannot be replayed until they end.
2. **Controls.** Play/pause, speed (1×, 2×, 4×, instant), previous/next step,
   a scrubber with markers for approvals, questions, errors and the final
   answer, and **Exit replay**.
3. **Pacing.** Events are fed to the projector in sequence order. At 1× the
   gap between two events follows their recorded times, capped at 2 seconds,
   so long waits do not stall the replay.
4. **Read-only.** The composer is hidden. Approval and question cards show the
   recorded decision and cannot be answered. Links to files open the current
   file if it still exists, otherwise show "not available in replay".
5. **Implementation.** A replay controller that decides how many stored
   events are visible, the existing projector (`src/lib/projector`) to
   project that prefix, and the `TimelineModeRenderer` that draws the live
   timeline, plus a replay toolbar. No new Brain endpoint: the events
   endpoint already returns what is needed.
   _Correction:_ the first draft of this plan named the `EventTimeline`
   renderer. The live Session view no longer renders `EventTimeline`; it goes
   through `EventNativeProjectTimeline` → `TimelineModeRenderer`, so replay
   reuses `TimelineModeRenderer` to look the same as the live view.
6. **Elapsed time.** A Run that has not ended yet in the replay measures its
   time to the last event shown, not to the wall clock.

## 5. Sharing

### 5.1 Creating a link

1. Session menu → **Share…** opens a dialog.
2. The person picks which Runs to include (default: all finished Runs) and
   what to include:
   - Messages and answers: always.
   - Tool calls and their results: on by default.
   - Thinking summaries: off by default.
   - Files the agent produced: off by default, chosen one by one.
3. **Preview** shows exactly what the viewer will see, after clean-up (§5.2).
4. **Create link** uploads the copy and copies the link. The person picks how
   long it lasts: 1 day, 7 days, 30 days or until stopped.

### 5.2 Clean-up before upload

The copy is built on the device from the Run events, then cleaned before it
leaves the device:

- Absolute local paths become paths relative to the Space folder. Other
  paths under a home folder (`/Users/<name>`, `/home/<name>`,
  `C:\Users\<name>`) start with `~` instead, so the user name is not shared.
- Values of environment variables, connector credentials and model keys are
  removed: fields named like keys, tokens, secrets, passwords, cookies or
  authorization, and credential shapes inside text (bearer tokens, provider
  key prefixes, private key blocks, `NAME_KEY=value`, `?token=` in URLs).
- Raw model requests and responses are not included (`model.invocation.*`),
  nor events that only describe this device (`run.environment_resolved`,
  `run.attempt_environment_bound`, `execution.*`, `admission.*`,
  `permission.action.*`, `workspace.writer.*`).
- File contents are included only for files chosen in the dialog.
- Run ids are replaced with `run-1`, `run-2`, … and event ids with
  `run-N:<sequence>`. The Session's own id is sent to the server so the owner
  can list links per Session, but it is not part of the public snapshot.

The preview in §5.1 is drawn from the cleaned copy itself, so people see
exactly what would be uploaded. Removed values show as `[removed]`.

### 5.3 Cloud side

- Store each Shared Session as a fixed snapshot with an owner, a random id,
  the included Runs, an expiry and a stopped flag. New Runs in the Session are
  not added; sharing again creates a new version under the same link.
- Public read: returns the snapshot for a valid, unexpired, not-stopped id.
  No account needed. Pages are `noindex`.
- Owner actions: list my links, change expiry, stop a link, delete it.
- The same endpoints in the self-hosted `server/` so self-hosted setups can
  share too.

### 5.4 Viewer

- A browser page at the share link renders the snapshot with the same
  event-native timeline and the replay controls from §4.
- Shows the Session name, the owner's display name if they allow it, the
  date, and an **Open in Eigent** button.
- Stopped or expired links show a plain "This link is no longer available"
  page.

### 5.5 Older Task share

Keep the older endpoints so links already sent keep working until they
expire. Replace the Home **Share** action with the new Session share, then
remove the desktop playback path (`handleSendShare`) one release later.

## 6. Open questions

1. Where does the viewer live: the Remote Control web app (already renders
   Run events in a browser) or the website? Recommended: the Remote Control
   web app, under its own public route.
2. Should viewers be able to copy a Shared Session into their own Eigent and
   continue from it? Recommended: later, not in the first version.
3. Do Workforce Sessions share per-worker timelines? Recommended: yes once the
   nested worker rows exist; the snapshot already contains the events.
4. Does sharing need a signed-in account? Recommended: yes for creating links,
   no for viewing.

## 7. Pull requests and order

1. Desktop: local Replay (§4). Can ship on its own.
2. Cloud and self-hosted `server/`: Shared Session storage, public read and
   owner actions (§5.3).
3. Viewer page (§5.4).
4. Desktop: Share dialog, preview, link management and the switch from Task
   share (§5.1, §5.2, §5.5).

The server change deploys before the desktop change that calls it.

_Change of order:_ the first pull request builds steps 1 and 4 together, the
desktop side of sharing included, against the server contract in its
description. Until the server endpoints exist the Share dialog still builds
and previews the cleaned copy, and **Create link** says sharing is not
available on this server yet. The switch from Task share (§5.5) is left for
when links work end to end.

## 8. Testing

- Unit:
  - Replay controller: order, pacing cap, pause/seek, instant speed, no
    commands sent while replaying.
  - Clean-up: paths made relative, secrets removed, unchosen files dropped,
    raw model data dropped; snapshot is stable for the same input.
  - Server: public read for valid / expired / stopped / unknown ids; owner
    list, stop and delete; another user cannot stop someone else's link.
- Manual:
  1. Replay a finished single-agent Session and a Workforce Session at 1× and
     4×; seek to an approval; exit replay.
  2. Share a Session with tool calls on and files off. Open the link in a
     private browser window without signing in. Replay it.
  3. Check the preview and the viewer contain no absolute paths or keys.
  4. Stop the link; reload the viewer; it shows the unavailable page.
  5. An older Task share link still opens until it expires.
- `npm run type-check`, `npm run lint`, focused server tests,
  `git diff --check`.

## 9. Built so far

| Part                                     | State                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replay (§4)                              | Built: Session menu → **Replay**; play/pause, 1×/2×/4×/instant, previous/next step, scrubber with approval, question, error and final-answer markers, **Exit replay**. Composer hidden while replaying. |
| Replay entry on each Run section         | Not built.                                                                                                                                                                                              |
| Share dialog, clean-up, preview (§5.1–2) | Built: choose Tasks, tool calls, thinking and files; preview of the cleaned copy; expiry; create and copy link.                                                                                         |
| Owner link list (§5.3 owner actions)     | Built in the dialog: list, copy, stop, delete. Changing expiry has a client call but no control yet.                                                                                                    |
| Cloud endpoints (§5.3)                   | Not in this repository; the expected contract is in the pull request description.                                                                                                                       |
| Self-hosted `server/` endpoints          | Not built.                                                                                                                                                                                              |
| Viewer (§5.4)                            | Not built.                                                                                                                                                                                              |
| Older Task share switch (§5.5)           | Not built; the Home **Share** action is unchanged.                                                                                                                                                      |
