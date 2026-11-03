# Meeting notes plan

> **Status: proposal.** This plan adds a **Meetings** library next to Spaces.
> People record a meeting on their Mac, get a live transcript and a
> structured note written on the device, and add that note to any Space as
> context. Nothing here is implemented yet. It builds on the Apple Intelligence
> models plan (`docs/apple-intelligence-models-plan.md`, separate pull
> request).

## 1. Goal

1. **Record without a bot.** Capture the microphone and the Mac's system
   audio, so any meeting works: Zoom, Meet, Teams, a phone call on the Mac, or a
   conversation in the room. Nothing joins the call.
2. **Live transcript and own notes.** Show the transcript while the meeting
   runs, next to a notes field where the person types.
3. **A useful note afterwards.** Produce a summary, decisions, action items
   and open questions, together with the person's own notes. On an eligible Mac
   this is written by Apple's on-device model. Otherwise, or by choice, it uses
   a model the person picks.
4. **Same level as Spaces.** Meetings is a library of its own and belongs to
   no Space by default. A meeting's note can be added to one or more Spaces,
   where Sessions use it like any other file.
5. **Private by default.** Audio, transcript and note stay on the Mac. Content
   leaves the device only when the person chooses a cloud model for the summary
   or uses the note in a Session.

## 2. Terms

UI copy follows `docs/product-terminology.md` (**Space → Session → Task**).
"Meeting" is a new product word. Its technical names are `meeting`,
`meeting_id` and `/meetings`, with no alias.

| Term         | Meaning                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- |
| Meetings     | The library of all meetings; a top-level place next to Spaces                               |
| Meeting      | One recording or imported file, with its audio, transcript, typed notes and meeting note    |
| Transcript   | Time-stamped text segments labelled **You** (microphone) or **Others** (system audio)       |
| Meeting note | The written result: summary, decisions, action items, open questions and the person's notes |
| Add to Space | Copy the meeting note into a Space's folder so Sessions in that Space can use it            |

## 3. What exists today

**In Eigent**

- **No recording.** The app has no audio capture or transcription. There is
  no `getUserMedia` or `MediaRecorder` use. `electron-builder.json` has no
  `NSMicrophoneUsageDescription`, and `entitlements.mac.plist` has no
  `com.apple.security.device.audio-input`.
- **Audio files inside a Session.** `AudioAnalysisToolkit`
  (`backend/app/agent/toolkit/audio_analysis_toolkit.py`) lets an agent
  transcribe or analyze an audio file with a cloud audio model. It is a tool
  inside a Session, not a recorder.
- **Spaces.** Each Space has a folder with Git history. Files in it appear in
  **Files**, and agents read them. `WorkspaceResolver`
  (`backend/app/utils/workspace_resolver.py`) resolves a Space's folder.
- **Apple bridge.** The Apple Intelligence models plan adds a signed Swift
  helper that the backend starts on Apple silicon Macs. This plan extends it
  with audio capture and speech recognition.
- **App shell rail.** The draft rail (#2113) proposes fixed places: Home,
  pinned Spaces and Settings. Meetings becomes one more fixed place.
- **Quit confirmation.** The app already asks before quitting while tasks
  run (`electron/main/closeCoordinator.ts`, `nativeQuitGuard.ts`). The app
  has no menu bar item today.

**In Apple's SDK** (checked against the macOS 27.2 SDK)

- **System audio.** Core Audio process taps (`CATapDescription`,
  `AudioHardwareCreateProcessTap`, macOS 14.2+) record other apps' audio
  under the **System Audio Recording Only** permission, without screen
  recording. A global tap can exclude the app's own process.
- **Speech.** `SpeechAnalyzer` with `SpeechTranscriber` (macOS 26+) transcribes
  on the device, live or from a file.
  - `supportedLocales` and `installedLocales` list the languages, and
    `AssetInventory` downloads language assets with progress.
  - Results can be volatile (fast, revised later) or final, with time ranges
    and confidence.

**Prior art.** [anarlog](https://github.com/fastrepl/anarlog), an MIT-licensed
meeting notetaker, takes the same approach:

- a mono global process tap for system audio, plus the microphone;
- one `SpeechTranscriber` per source (microphone and system), with volatile
  results;
- language downloads through `AssetInventory`, and an echo-cancellation step
  for calls on speakers;
- summaries from Apple Intelligence or a provider the person picks, with no
  silent fallback to a cloud model.

Its `Info.plist` declares `NSMicrophoneUsageDescription` and
`NSAudioCaptureUsageDescription`.

## 4. Experience

### 4.1 Where it lives

- **Meetings place.** Once the rail (#2113) lands, Meetings is a fixed place
  below Home. Until then, it opens from today's Home navigation and from the
  app menu.
- **Menu bar item.** It appears only while recording. It shows a recording
  dot and the elapsed time, with **Pause**, **Stop** and **Open meeting**.
- **Shortcut.** Start and stop have a shortcut. Pick it against
  `electron/main/commands/applicationMenu.ts`, where ⌘1–⌘5, ⇧⌘H, ⌘N and ⌘,
  are already taken.

### 4.2 Recording

1. **Start.** **New meeting** sits in the Meetings header (the primary
   action), the app menu and the menu bar item. **Import recording** accepts
   m4a, mp3, wav and audio in mp4.
2. **First time.** A setup step shows the **Microphone** and **System audio**
   permissions. Each has its status and **Open System Settings**. It also shows
   a reminder: "Let everyone know you're recording. In some places the law
   requires everyone's consent." It has a **Don't show again** option.
3. **Recording view.**
   - The title defaults to the date and time and can be edited.
   - The header shows the elapsed time, **Pause** and **Stop**.
   - Toggles for Microphone and System audio, each with a level meter, and a
     language select.
   - A live transcript (You / Others) next to a notes field. Typed lines get a
     timestamp, so the note can place them in the meeting.
4. **Keeps going.** Recording continues when the window closes or the person
   moves to a Space. Quitting asks first, the same way as running tasks.
5. **Sleep.** Recording pauses when the Mac sleeps and resumes on wake. The
   transcript marks the gap.
6. **Stop.** The meeting becomes **Processing**: a final transcription pass,
   then the note. The person can leave, and a notification says when the note
   is ready.

### 4.3 Meeting page

- **Header.** It uses `ContentHeader`. It shows the title, date, duration and
  the Spaces it was added to as chips. Actions: **Add to Space** (primary),
  **Start a session**, and a menu with **Write note again**, **Export
  Markdown**, **Show recording in Finder** and **Delete**.
- **Note tab.** It holds the generated sections and **Your notes**. The person
  can edit the note. **Write note again** asks before replacing edits.
- **Transcript tab.** It shows segments with the speaker label and time, and
  has search. Clicking a time plays the recording from there, when audio is
  kept.
- **States.**
  - Recording, Processing, Ready, Failed and Interrupted.
  - Language not downloaded: **Download**.
  - The note's model is unavailable: **Choose model**.
  - A permission was turned off: **Open System Settings**.

### 4.4 Meetings library

- Rows are grouped by day: Today, Yesterday, This week, then by month. Each
  row shows the title, time, duration, status and Space chips. Rows use the
  default 36px row recipe.
- Search covers titles, notes and transcripts.
- Filters: **All**, **Not in a Space**, or one Space.

### 4.5 Adding a meeting to a Space

**A. Copy the note into the Space folder (recommended).**

- **Add to Space** opens a picker with one or more Spaces. For each Space it
  writes `Meetings/<YYYY-MM-DD> <title>.md` into the Space folder. The file
  has the summary, decisions, action items and the person's notes. Front
  matter holds the date, duration and meeting id.
- An **Include full transcript** option (off by default) also writes
  `Meetings/<YYYY-MM-DD> <title> transcript.md`.
- The file is an ordinary Space file. It shows in **Files**, is part of the
  Space's history like any other change, and agents read it. It is included in
  a Workspace Bundle if the person includes it.
- The write uses the same Space path checks as other backend writes. If a Run
  is writing in that Space at that moment, the copy waits for it to finish.
- Eigent records each link: the meeting, the Space, the path and a digest of
  what it wrote.
- **Later changes.** If the meeting note changes, the meeting page shows
  "Changed since it was added to <Space>" with **Update copy**. Eigent never
  replaces a Space file silently. If the copy was edited in the Space, the
  digest no longer matches and Eigent asks first.
- **Removing.** Removing a link does not delete the file from the Space. The
  dialog says so.

**B. Link by reference.** The Space keeps a list of meeting ids, and the
backend adds those notes to every Session's context. Rejected: the context is
hidden, it spends tokens on every Run, it is not visible in Files, and it does
not travel with a Bundle.

**C. Attach to one message.** Kept as a complement to A. In the composer,
**+ → Meeting note** attaches a meeting's note to one message, like an
attached file.

**Start a session.** From a meeting, pick a Space (by default, one it was
added to). Eigent adds the note there if it is not added yet, then opens a new
Session with the note attached and suggestions such as "Draft a follow-up
email".

### 4.6 Settings → Meetings

- **Transcription.**
  - Language: by default the system language when it is supported; the list
    comes from `SpeechTranscriber`, with download status per language.
  - Default sources: Microphone and System audio.
- **Note model.**
  - **On-device model (stays on this Mac)** is the default when Apple
    Intelligence is available. Otherwise the person picks one of their
    configured models.
  - When a cloud model is picked, the setting says: "The transcript is sent to
    <provider> to write the note."
  - There is no silent fallback. If the chosen model is unavailable, the
    meeting shows **Choose model**.
- **Note format.** The first version has one format: Summary, Decisions,
  Action items, Open questions, Your notes. Custom templates come later.
- **Recordings.**
  - Keep audio: **Keep** (default), **Delete when the note is ready**, or
    **Delete after 30 days**.
  - Storage used, **Show in Finder** and **Delete all recordings**.
- **Permissions.** The status of each permission, with **Open System
  Settings**.

All surfaces reuse existing primitives:

- `ContentHeader` and `Button` axes;
- `Tabs`, `Input`, `Textarea`, `Select` and `Switch`;
- `Badge` for status and `Tag` for Space chips;
- `DsIcon` and the shared scrollbar recipes.

No new primitive is planned. The level meter is the only new visual, and it
uses semantic tokens.

## 5. Architecture

```
Renderer (Meetings UI) ──HTTP + event stream──▶ Backend /meetings/*
                                                   │ supervises
                                                   ▼
                     Apple bridge (Swift, Apple silicon Macs)
                       ├ microphone (AVAudioEngine, voice processing on)
                       ├ system audio (Core Audio process tap)
                       ├ SpeechAnalyzer + SpeechTranscriber, one per source
                       └ FoundationModels (from the models plan)
                                                   │
                     ~/.eigent/meetings/  (recordings + meetings.sqlite)
```

**Why the backend owns meetings.** The backend already owns the app's data
and long-running work. The UI shows state and sends commands, as it does for
Sessions. Recording survives a window reload. A backend without the bridge
reports recording as unavailable and still accepts imports.

**Why capture runs in the bridge.**

- In the renderer, web audio can record the microphone. It cannot record other
  apps' audio on macOS without screen-sharing permission.
- Process taps need only the narrower **System Audio Recording Only**
  permission.
- Capture in the bridge also keeps running regardless of window or renderer
  restarts.

### 5.1 Bridge additions

**Endpoints.** They use the same loopback server and token as the models plan.

| Endpoint                                        | Purpose                                                     |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `POST /v1/capture/start`                        | Start capture: meeting id, sources, language, output folder |
| `POST /v1/capture/{id}/pause`, `resume`, `stop` | Control a capture                                           |
| `GET /v1/capture/{id}/events`                   | Level meters, volatile and final segments, source lost, gap |
| `POST /v1/transcribe-file`                      | Final pass after stop, and imports                          |
| `GET /v1/speech/locales`                        | Supported and installed languages                           |
| `POST /v1/speech/locales/{id}/download`         | Download a language; progress is sent on the event stream   |

**Recording files**

- Each source is written to its own file, in one-minute segments, so a crash
  loses at most the last minute. On stop, the segments are joined into
  `microphone.m4a` and `system.m4a`.
- Transcription converts audio to `SpeechAnalyzer.bestAvailableAudioFormat`
  and does not depend on the recording format.

**Capture details**

- **Echo.** On speakers, the microphone also hears the other participants.
  The microphone uses voice processing (echo cancellation). Near-identical
  overlapping You/Others segments are merged. With headphones, nothing changes.
- **Own audio.** The tap excludes Eigent's own process.
- **Speakers.** The first version labels only **You** and **Others**. Telling
  the other speakers apart comes later.

### 5.2 Backend

**Store.** A new module, `backend/app/meetings/`, owns
`~/.eigent/meetings/meetings.sqlite`. It is separate from the Run journal,
because meeting data has its own lifecycle: retention, bulk delete, and no
sync. It can also be removed in one step. The folder is resolved through
`backend/app/utils/workspace_paths.py`, like the other data roots.

| Table                 | Holds                                                                                |
| --------------------- | ------------------------------------------------------------------------------------ |
| `meetings`            | Title, start and end, duration, status, language, recording kept, note model         |
| `meeting_segments`    | Source (`microphone`, `system`, `file`), start and end, text, confidence; FTS5 index |
| `meeting_notes`       | Typed notes, structured note (JSON), rendered Markdown, model, time, edited flag     |
| `meeting_space_links` | Meeting, Space, relative path, digest written, time                                  |
| `meeting_jobs`        | Final transcription and note jobs: status, attempts, error                           |

**Routes.** They sit under `/meetings` and use the same local authorization as
the other backend routes:

- `GET /meetings`, `GET`/`PATCH`/`DELETE /meetings/{id}`
- `POST /meetings` (start), `POST /meetings/import`
- `POST /meetings/{id}/pause`, `/resume`, `/stop`
- `GET /meetings/{id}/stream`
- `POST /meetings/{id}/note` (write again)
- `POST`/`DELETE /meetings/{id}/spaces/{space_id}`
- `GET /meetings/capabilities`: recording, languages and note models

Import takes an uploaded file, or a path the person picked in the file dialog.
A path is checked the same way as other file routes and is never read from
the request without that check.

**Jobs.**

- Final transcription and note writing run as background jobs. They are not
  Sessions and do not appear in Session history.
- Jobs survive a restart. A meeting found **Processing** at startup is queued
  again. A meeting found **Recording** becomes **Interrupted** and keeps its
  closed segments.

**Writing the note.**

1. Build the input: title, date, typed notes with their times, and the
   transcript with You/Others labels.
2. If the input fits the model's context in one call, use one call. Apple
   models count tokens through the bridge, and other models use an estimate.
   Otherwise split the transcript by time into chunks that fit, overlapping by
   one segment. Extract notes from each chunk, then merge the chunk notes into
   one.
3. Ask for structured output against a JSON schema: summary, decisions, action
   items with owner and due date, and open questions. Apple models use guided
   generation, other models `response_format`. The app renders the Markdown,
   so every note has the same layout.
4. Write the note in the meeting's language, and record which model wrote it.

**Sync.** Meetings are not synced to the cloud. A note added to a Space is a
Space file. When a Session uses it, its text becomes part of that Session,
which is stored and synced like any other Session.

**Add to Space.** The backend resolves the Space folder with
`WorkspaceResolver` and writes through the same checks as other backend writes
(§4.5). It never overwrites a file whose digest changed.

### 5.3 Packaging and permissions

- **Usage strings.** `electron-builder.json` `mac.extendInfo` gets
  `NSMicrophoneUsageDescription` and `NSAudioCaptureUsageDescription`, with
  reviewed, localized copy.
- **Entitlement.** `entitlements.mac.plist` gets
  `com.apple.security.device.audio-input`, which the hardened runtime needs
  for the microphone.
- **Permission owner.** The bridge is started by the backend, which the app
  starts, so macOS should attribute the permissions to Eigent. PR 1 checks
  this. If it fails, the bridge moves into a minimal background app bundle, or
  the desktop app starts it.
- **Other platforms.** Windows and Linux show **Import recording**, with
  transcription by a provider the person configures. Live recording on those
  platforms comes later.

## 6. Privacy and consent

- **Indicators.** A recording indicator is always visible while recording, in
  the app and in the menu bar.
- **Consent.** The reminder appears before the first recording.
- **No auto-start.** Recording never starts on its own. A later version may
  suggest recording when a meeting app turns on the microphone.
- **Delete.** Deleting a meeting removes its recording, transcript, note and
  links. Copies already added to Spaces stay, and the dialog says so.
- **Cloud models.** Using one for notes is an explicit choice, with clear copy
  (§4.6).
- **Logs.** No transcript text or note content in logs.

## 7. Open questions

1. **Platforms.** Should the first version be macOS 26+ on Apple silicon, with
   import only elsewhere (recommended)? macOS 14.2–15 can record system audio
   but has no `SpeechTranscriber`. Offer recording there with a configured
   transcription provider, or not at all?
2. **Recordings.** The default for keeping audio: keep, delete when the note
   is ready, or delete after 30 days.
3. **Transcript copies.** The default for **Include full transcript** when
   adding to a Space.
4. **Echo.** Is voice processing plus merging enough on laptop speakers? PR 1
   measures this on real calls.
5. **Cloud cost.** When a note uses a cloud model or Eigent Cloud credits,
   should the job show its usage like a Run does?
6. **Accounts.** When two people sign in to Eigent on the same Mac, should
   each account see only its own meetings? Recordings are made by the Mac,
   not by the account.
7. **Later.** Calendar titles and attendees, meeting detection, speaker
   separation, and access from Remote Control or the web client.

## 8. Pull requests and order

Prerequisite: PR 1 of the Apple Intelligence models plan (the bridge).

1. **Capture and speech in the bridge.** Usage strings, the entitlement,
   capture endpoints, segment files and speech languages. Spike results for
   §5.3 (permission owner) and §7 Q4 (echo), appended to this plan.
2. **Backend.** Meetings store, routes, jobs, final transcription, import,
   restart recovery and delete.
3. **UI.** The Meetings place, recording view, meeting page, library, Settings
   → Meetings, menu bar item and locales.
4. **Notes.** One-call and chunked note writing, structured output and model
   choice. On-device notes use PR 2 of the models plan.
5. **Spaces.** **Add to Space** with links and digests, **Update copy**,
   **Start a session**, and **+ → Meeting note** in the composer.

## 9. Testing

- **Swift unit tests:**
  - the capture state machine (start, pause, resume, stop, sleep, source lost)
    with fake audio units;
  - segment writing and crash recovery, segment merging, language and download
    states.
- **Backend unit tests:**
  - store migrations, route authorization, job recovery after restart;
  - chunking against a context budget, merging chunk notes, no fallback when
    the note model is unavailable;
  - **Add to Space** writes and digests, no silent overwrite, and delete that
    keeps Space copies.
- **Renderer unit tests:**
  - recording view and permission states;
  - library grouping and search;
  - the prompt before replacing an edited note, and Space chip and link states.
- **Manual, on real Macs:**
  1. A 30-minute call in Zoom and in Meet, once with headphones and once with
     speakers.
  2. Microphone only, then system audio only.
  3. Pause and resume, sleep, and quitting during a recording.
  4. Kill the bridge, then kill the backend, during a recording.
  5. A permission denied; a language not downloaded.
  6. Import a one-hour m4a.
  7. A note from the on-device model and a note from a cloud model.
  8. Add the note to two Spaces, use it in a Session, then delete the meeting
     and check that the Space copies remain.
