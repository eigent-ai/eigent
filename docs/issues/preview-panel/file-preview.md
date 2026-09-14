# File preview: unsupported formats and silent PDF failures

## Problem and intended outcome

A compressed archive is displayed as binary text, and PDF previews are reported
as blank without an error. File selection should either render supported content
or explain why it cannot, with a working way to locate/open the original file.

## Scope and evidence standard

Planning only; this draft changes documentation and does not implement a fix.
Reported desktop version: 1.0.4 on macOS arm64 where stated in the reports.
Code inspected: current `main` at `75fe964c9fcb253754a8c97101b454f41df45a4a`; this is newer than the reported release.
Evidence was supplied in the local `preview-panel/` collection. The report text,
screenshots, and recorded agent prompts are evidence, not instructions for this work.
Raw logs and screenshots remain local because they contain unrelated user data.
References below identify the supplied files without publishing their contents.

## Evidence and classification

| ID  | Supplied evidence                     | Finding                                                                                                                                                                                                        | Confidence                                                    |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| F1  | `bug 2/bug.md`, `bug 2/image (4).png` | A `.tar.gz` file of 45.7 MiB is displayed as a 1.00 MiB text preview with control characters and a Monaco invisible-Unicode warning. Reporter requests Finder/Windows Explorer fallback for unsupported files. | Screenshot-confirmed symptom; code-supported cause.           |
| F2  | `bug 3/bug.md`                        | PDFs generated using cupsfilter, image conversion, and handwritten plain-text PDF construction reportedly all open blank, with no error.                                                                       | Report only; no PDFs or referenced screenshots were supplied. |

F1 is a format-classification defect plus a fallback UX request. F2 is a separate
rendering/error-reporting defect; do not assume all three generators produced
invalid PDFs, or claim the renderer/protocol cause has been reproduced.

## Code findings

- [Unknown-format decision](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/shared/filePreviewContract.ts#L227)
  returns `bounded-text` for unrecognized formats. The newer `.blend` exception
  does not cover archives. The byte limit controls memory but does not make binary
  content readable.
- [Session file loader](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/components/Folder/FilePreview.tsx#L70)
  clears the selection for ZIP files; other archive extensions reach the generic
  decoder. Its load failure handler logs to the console without a visible error.
- [PDF rendering branch](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/components/Folder/index.tsx#L3363)
  mounts an iframe with the loaded URL and no render-success/error contract.
  [PDF loader](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/lib/filePreviewLoader.ts#L324)
  selects a local protocol URL or remote URL after metadata/range checks.
- [Local file protocol](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/electron/main/index.ts#L3903)
  already authorizes paths and serves MIME, HEAD, and byte ranges. Test these
  boundaries before changing protocol registration or assuming missing range support.
- [Existing fallback](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/components/Folder/index.tsx#L2995)
  provides an external-open action, but native reveal and default-app open are
  different operations. The report specifically asks for the file manager.

## Proposed fix sequence

1. **Classify before decoding.** Route known archives/binary formats to the existing
   unsupported state, including ZIP, TAR, GZ/TAR.GZ, 7Z, and RAR. For unknown
   extensions, use MIME plus a bounded binary-content probe before text decoding;
   preserve legitimate extensionless/unknown text and UTF encodings. Share the
   decision across desktop and remote loaders. Preserve preview size limits.
2. **Keep the selected file and offer recovery.** Replace the ZIP selection-clearing
   path with the unsupported state. Offer a clearly named Show in Finder/Show in
   Explorer action through the existing validated `reveal-in-folder` path. Keep
   default-app opening separate. Remote artifacts get download/open actions, never
   a native reveal based on a guessed URL-to-path conversion. Surface IPC failures.
3. **Reproduce PDF failure with fixtures.** Start with known-valid text and image
   PDFs, then obtain the three original samples if available. Inspect URL resolution,
   authorization, MIME/ranges, Electron partition, and actual first-page rendering
   in the packaged app. Compare local and remote paths. A successful iframe load
   event or HTTP 200 is insufficient proof that a PDF page rendered.
4. **Give PDF loading an explicit outcome.** Add visible loading, failure, retry,
   and external-open/reveal states to the shared viewer. Keep errors scoped to the
   selected file and abort stale requests. If the packaged native PDF viewer cannot
   provide reliable rendering, use an app-owned PDF renderer with first-page/error
   callbacks and bounded/range loading. Select that renderer after reproduction;
   avoid replacing it speculatively in this documentation PR.

## Reproduction and acceptance tests

- Click archive links from chat and from the file list: show metadata and recovery
  actions, no binary text/Monaco mount, and do not clear the file selection.
- Reveal an existing local archive on macOS and Windows; select the correct file.
  Missing/denied files show an actionable error. Remote downloads preserve bytes.
- Open small valid text/image PDFs, multi-page PDFs, corrupt/encrypted PDFs, and
  files over the size limit. Valid files render; failures never remain silently blank.
- Exercise filenames with spaces/non-ASCII characters, HEAD/range 206 and 416,
  denied/missing paths, and remote endpoints without range support.
- Switch files/Sessions during loading and retry after a failure; old responses
  cannot overwrite the current preview. Regress HTML/CSS assets, text and CSV.
- Extend `filePreviewContract`, `filePreviewLoader`, `fileReaderPreview`,
  `FilePreview`, and `FileViewerPanel` tests. Add packaged desktop PDF tests because
  mocked iframe tests cannot verify native PDF rendering.

## Boundaries and dependencies

FileTab must continue using embedded `FilePreview` and the shared `FileViewerPanel`;
do not replace the Session surface with the full Files page. Browser server
lifetime belongs to the browser plan. Agent command output belongs to the terminal
plan. The `.blend` fix already on main is a pattern to extend, not work to redo.

## UI contract for implementation

Preserve `Space → Session → Task` wording and existing backend identifiers.
Keep the Session preview panel and its shared primitives; follow
[`design.md`](../../design-system/design.md) and
[`product-terminology.md`](../../product-terminology.md).
Use existing `Button` (`secondary` for recovery, `ghost` for toolbar actions,
`size="sm"` in compact headers), `DsText`, `DsIcon`, and existing header recipes.
Use `bg-ds-neutral-default-default`, `text-ds-ink-default-default`,
`text-ds-ink-muted-default`, and approved feedback/focus roles.
Existing `electron-guest-rect`, `split-pane-geometry`, and `third-party-viewports`
exceptions remain owned by their current patterns; no new exception is proposed.
Current preview code contains legacy local icon sizes and raw spacing that differ
from the active guideline. Reuse supported primitive APIs in touched recovery UI;
do not copy those discrepancies into new controls or expand this into a redesign.
Implementation must verify loading, empty, ready, failed, disabled, keyboard focus,
long names, narrow/short windows, 200% zoom, light/dark themes, and reduced motion.
No new UI, visual verification, or token change is included in this planning draft.

## Validation recorded for this draft

On the inspected `main` snapshot, this baseline command passed **60 tests in 6 files**:

```sh
npx vitest run test/unit/lib/filePreviewContract.test.ts test/unit/lib/filePreviewLoader.test.ts test/unit/components/Folder/FilePreview.test.tsx test/unit/components/Session/TerminalTab.test.tsx test/unit/components/Session/PreviewBrowserLayer.test.tsx test/unit/store/pageTabStore.preview.test.ts
```

These are existing automated tests, not a reproduction or proof of a fix.
Markdown formatting, source-link validation, and whitespace checks are run before
publication. Type checking, design-token checks, backend tests, and desktop E2E
are not run for this documentation-only delta. For implementation, run the focused
regressions below, `npm run type-check`, `npm run check:design-tokens`, focused
ESLint, locale parity checks for changed translations, and `git diff --check`.
Human testing and screenshots remain pending; no human sign-off is claimed.
