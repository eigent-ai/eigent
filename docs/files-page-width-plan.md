# Files page width plan

> **Status: proposal.** This plan fixes the Files page message that breaks
> into one word per line when a folder is selected, and stops the same mistake
> from coming back. Nothing here is implemented yet.

## 1. Problem

In a Space, open **Files** and select a folder in the file tree. The content
pane is wide, but the message in the middle shows one word per line:

```text
          [folder icon]
             pr2141
               Use
               the
             actions
              above
               to
              open
              ...
```

The page looks as if it does not use its full width. The header row
(breadcrumb, **Open in Finder**, file tree toggle) is laid out correctly; only
the centred message is squeezed.

## 2. Cause

The message lives in `src/components/Folder/index.tsx` (the `isFolder` branch
of `FileViewerPanel`):

```tsx
<div className="flex h-full min-h-64 w-full items-center justify-center px-6 py-10">
  <div className="flex max-w-md flex-col items-center gap-2 text-center">
```

`tailwind.config.js` extends `theme.spacing` with the named steps
`xs, sm, md, lg, xl` (`md` is `var(--spacing-md, 16px)`). In Tailwind 4,
`max-w-*` looks up `--max-width-*`, then `--spacing-*`, then `--container-*`.
Because `--spacing-md` exists, `max-w-md` resolves to **16px**, not the usual
28rem. A production build confirms it: the bundled CSS contains
`.max-w-md{max-width:var(--spacing-md,16px)}`. A 16px column is narrower than
any word, so each word gets its own line.

The same collision affects other named `max-w-*` classes on main:

| File                                       | Class             | Effect today                                                               |
| ------------------------------------------ | ----------------- | -------------------------------------------------------------------------- |
| `src/components/Folder/index.tsx`          | `max-w-md`        | Folder message, one word per line                                          |
| `src/components/SpacesHub/index.tsx`       | `max-w-md`        | Spaces empty state is squeezed                                             |
| `src/components/ErrorBoundary/index.tsx`   | `max-w-md`        | Error card is squeezed                                                     |
| `src/components/Trigger/TriggerDialog.tsx` | `max-w-md`        | Automation summary line is squeezed                                        |
| `src/pages/RemoteControl.tsx`              | `w-full max-w-md` | Card is 16px wide at most                                                  |
| `src/components/ui/sheet.tsx`              | `sm:max-w-sm`     | Side sheets capped at 8px from `sm` (used only by the mobile `ui/sidebar`) |

## 3. Fix

1. **Folder message.** Remove `max-w-md` from the inner column. The design
   guideline (`docs/design-system/design.md`, Typography rules) says
   supporting copy inherits the inline size of its layout and feature code
   must not add a local `max-w-*` to shorten copy. The outer container already
   has `px-6`, so the text wraps at the pane edge.
2. **Other call sites.** For each row in the table above, check what width
   was meant:
   - Empty states and the error card: drop the cap, like the Folder message.
   - Remote Control card and side sheets: these are containers, not copy.
     Use the layout token or registered exception that already owns that
     width, or an explicit `max-w-[28rem]` / `sm:max-w-[24rem]` if no token
     exists, and note it in the PR.
   - Automation summary line: keep `line-clamp-2`, drop the cap.
3. **Guard.** Add a check that fails when `max-w-{xs,sm,md,lg,xl}` (with or
   without a responsive prefix) appears in `src/`, with a message explaining
   that these names resolve to spacing tokens. Put it next to the existing
   design-system checks so it runs in CI.

No change to `tailwind.config.js` or generated tokens: renaming the spacing
steps would touch every `p-md`, `gap-sm` and similar class in the app.

## 4. Out of scope

- The wider Files page layout (file tree rail width, header wrapping).
- `min-w-*` and `w-*` named classes. A quick search finds no named uses today;
  the guard can cover them later if they appear.

## 5. Testing

- Unit: a render test for `FileViewerPanel` with a folder selected that
  checks the inner column has no `max-w-md` class.
- Guard: run the new check on main (fails) and on this branch (passes).
- Manual, desktop app:
  1. Open a Space, open **Files**, select a folder. The message wraps across
     the pane width.
  2. Repeat with the file tree hidden, a narrow window, 200% zoom, dark theme,
     and a long translated string (de, fr).
  3. Open the Spaces hub with no Spaces and force the error boundary; both
     read normally.
- `npm run type-check`, `npm run lint`, `git diff --check`.

## 6. Pull requests

One pull request: the class fixes, the guard and the test.
