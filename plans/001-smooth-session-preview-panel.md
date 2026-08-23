# 001 — Make the Session preview panel reversible and smooth

- **Status**: DONE
- **Commit**: Included with the implementation change
- **Severity**: HIGH
- **Category**: Interruptibility, performance, and accessibility
- **Estimated scope**: 2 files, about 35 lines

## Problem

The Session preview panel opens and folds with asymmetric layout motion in
`src/components/Session/index.tsx:546`. The entering state does not define
`flexGrow`, so the `flex-1` class gives the panel its full layout width
immediately, while the exit explicitly animates `flexGrow` to zero. The same
element also animates `clipPath`, which adds paint work during a large panel
resize, and the fixed-duration tween restarts rather than carrying motion when
the user quickly reverses the action.

```tsx
// src/components/Session/index.tsx:546 — current
<AnimatePresence initial={false}>
  {previewOpen && (
    <motion.div
      key="session-display-content"
      initial={{
        clipPath: 'inset(0 0 0 100%)',
        opacity: 0,
      }}
      animate={{
        clipPath: 'inset(0 0 0 0%)',
        opacity: 1,
        flexGrow: 1,
      }}
      exit={{
        clipPath: 'inset(0 0 0 100%)',
        opacity: 0,
        flexGrow: 0,
      }}
      transition={{ duration: 0.3, ease: DISPLAY_PANEL_EASE }}
      style={{ transformOrigin: 'right center' }}
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
```

The movement also has no `prefers-reduced-motion` branch.

## Target

Keep the existing Session layout, resizing behavior, preview tabs, and browser
settling boundary. Replace the `clipPath` tween with one reversible Framer
Motion spring that grows the panel from zero in both directions and uses a
small compositor transform for spatial continuity:

```tsx
const DISPLAY_PANEL_SPRING = {
  type: 'spring' as const,
  duration: 0.5,
  bounce: 0.2,
};
const DISPLAY_PANEL_FADE = {
  duration: 0.2,
  ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
};

initial={
  shouldReduceMotion
    ? { flexGrow: 1, opacity: 0, transform: 'translateX(0%)' }
    : { flexGrow: 0, opacity: 0, transform: 'translateX(3%)' }
}
animate={{ flexGrow: 1, opacity: 1, transform: 'translateX(0%)' }}
exit={
  shouldReduceMotion
    ? { flexGrow: 0, opacity: 0, transform: 'translateX(0%)' }
    : { flexGrow: 0, opacity: 0, transform: 'translateX(3%)' }
}
transition={
  shouldReduceMotion
    ? {
        flexGrow: { duration: 0 },
        transform: { duration: 0 },
        opacity: DISPLAY_PANEL_FADE,
      }
    : {
        flexGrow: DISPLAY_PANEL_SPRING,
        transform: DISPLAY_PANEL_SPRING,
        opacity: DISPLAY_PANEL_FADE,
      }
}
```

The full transform string is intentional: it keeps the visual translation on
the compositor rather than using Framer Motion's `x` shorthand. Opacity uses
the strong UI ease-out curve `cubic-bezier(0.23, 1, 0.32, 1)`. Reduced-motion
mode allocates/removes layout space immediately and keeps only the 200 ms fade.

Update `DISPLAY_PANEL_ANIMATION_MS` to `500` so the fixed-position Electron
browser guest remains parked until the spring has settled.

## Repo conventions to follow

- `src/components/Session/SidePanel/components/AccordionBox.tsx` already uses
  Framer Motion's `useReducedMotion()` for reversible disclosure motion.
- `src/components/Session/index.tsx` owns the Session preview layout and browser
  settling contract; do not move this behavior into `PreviewPanel` or `Folder`.
- Keep `AnimatePresence initial={false}` so a preview restored with the Project
  does not replay an entrance during initial hydration.

## Steps

1. In `src/components/Session/index.tsx`, replace `DISPLAY_PANEL_EASE` with the
   exact spring and fade constants above, and change
   `DISPLAY_PANEL_ANIMATION_MS` from `300` to `500`.
2. Import `useReducedMotion` from `framer-motion` and read it once inside
   `Session` as a boolean named `shouldReduceMotion`.
3. Replace the preview motion element's `clipPath` states and single transition
   with the exact `flexGrow`, full-string `transform`, opacity, and per-property
   transitions above. Remove the obsolete `transformOrigin` style.
4. In `test/unit/components/Session/SessionResize.test.tsx`, extend the existing
   `framer-motion` mock with `useReducedMotion: () => false`, and strip any new
   Framer-only props before spreading DOM props if needed.

## Boundaries

- Do NOT modify `src/components/Session/PreviewPanel/**` tab markup or content.
- Do NOT modify `src/components/Folder/**`; Session preview remains on its
  existing `FilePreview` path.
- Do NOT change the resize math, pointer capture, remembered chat width, or
  fixed-position browser parking behavior.
- Do NOT change side-panel dimensions, chat width constants, or design tokens.
- Do NOT add dependencies.
- If these locations no longer match commit `d43af4a5`, stop and report drift
  instead of improvising.

## Verification

- **Mechanical**:
  `npx vitest run test/unit/components/Session/SessionResize.test.tsx test/unit/components/Session/PreviewPanel.test.tsx`, then
  `npx eslint src/components/Session/index.tsx test/unit/components/Session/SessionResize.test.tsx`,
  `npx prettier --check src/components/Session/index.tsx test/unit/components/Session/SessionResize.test.tsx`, and
  `git diff --check` must all pass.
- **Feel check**: open and close the Session preview, then quickly reverse it.
  Confirm the panel grows from the right-hand side without an initial width
  snap, folding continues from its current position, and the chat remains
  readable rather than stretching. In DevTools, set animation playback to 10%
  and confirm no `clip-path` reveal runs. Emulate `prefers-reduced-motion` and
  confirm the panel only fades while its layout space changes immediately.
- **Done when**: open and close use the same interruptible spring, rapid
  reversal does not restart from zero, reduced motion removes translation and
  layout interpolation, and the focused Session tests pass.
