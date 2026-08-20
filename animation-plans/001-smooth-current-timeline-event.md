# 001 — Smooth and focus the current timeline event

- **Status**: DONE
- **Commit**: 85af2129
- **Severity**: HIGH
- **Category**: Purpose, interruptibility, accessibility, cohesion, and missed opportunities
- **Estimated scope**: 2 frontend files, roughly 180 lines including tests

## Problem

The Normal timeline currently derives visual emphasis independently inside every
row. Consequently, every pending or running tool can shimmer and auto-expand,
while generic activity text, repeated-tool summaries, and Workforce actor
headings can shimmer at the same time. This makes several events look current,
and progress/reasoning text such as “Searching for README files in the project”
looks like muted loading copy instead of normal timeline narration.

```tsx
// src/components/ChatBox/TimelineModes/NormalTimeline.tsx:123 — current
const active =
  runActive &&
  (invocation.status === 'running' || invocation.status === 'pending');
const failed = isToolErrorStatus(invocation.status);
const autoExpanded = active;
```

```tsx
// src/components/ChatBox/TimelineModes/NormalTimeline.tsx:274 — current
if (node.kind === 'activity') {
  const active =
    runActive && (node.status === 'running' || node.status === 'pending');
  // ...
  return active ? <ShinyText text={text} /> : <span>{text}</span>;
}
```

The flat and Workforce event lists render ordinary keyed rows, so new streamed
events appear in their final position without an entry transition or layout
settling. A related identity bug makes the first tool remount when a second
consecutive matching tool turns it into an accordion: the singleton key is the
row ID, while the group key adds a prefix.

```tsx
// src/components/ChatBox/TimelineModes/NormalTimeline.tsx:597 — current
if (calls.length === 1) {
  items.push({ kind: 'event', id: item.row.id, item });
} else {
  items.push({
    kind: 'event-group',
    id: `normal-event-group:${item.row.id}`,
    calls,
    methodName: identity.methodName,
    toolkitName: identity.toolkitName,
  });
}
```

```tsx
// src/components/ChatBox/TimelineModes/NormalTimeline.tsx:949 — current
<div className="flex min-w-0 flex-col gap-2 py-2" data-normal-flat-timeline>
  {flatItems.map((item) => (
    <NormalDisplayRow key={item.id} item={item} runActive={active} />
  ))}
</div>
```

Finally, the Normal timeline does not call `useReducedMotion`. Its nested
disclosures always interpolate `height`, and any new row entry animation would
add positional movement for users who request reduced motion.

## Target

There must be exactly one visible shimmer representing the current tool call in
each active run:

- Find pending/running tool rows only and choose the row with the greatest
  `runSequence`. If two rows have the same sequence, the later row in timeline
  order wins.
- A terminal run has no highlighted tool even if a stale row still says running.
- Keep `running` separate from `highlighted`: all running tools retain “Waiting
  for a response.”, but only the highlighted tool shimmers and auto-expands.
- In a collapsed repeated-tool group containing the highlighted call, the group
  title is the one shimmer proxy. When expanded, the group title becomes static
  and only the highlighted child shimmers.
- Generic activity/reasoning rows and actor headings never shimmer. Non-failed
  activity text uses `text-ds-text-neutral-default-default`; failed,
  timed-out, and outcome-unknown activity text keeps
  `text-ds-text-status-error-default-default`.

New event display items must mount with this exact motion:

```ts
const EVENT_ENTER_TRANSITION = {
  duration: 0.18,
  ease: [0.32, 0.72, 0, 1],
} as const;
const REDUCED_EVENT_ENTER_TRANSITION = {
  duration: 0.12,
  ease: [0.32, 0.72, 0, 1],
} as const;
const EVENT_LAYOUT_TRANSITION = {
  duration: 0.22,
  ease: [0.32, 0.72, 0, 1],
} as const;
```

Normal motion:

```tsx
initial={{ opacity: 0, transform: 'translateY(6px)' }}
animate={{ opacity: 1, transform: 'translateY(0px)' }}
layout="position"
transition={{
  opacity: EVENT_ENTER_TRANSITION,
  transform: EVENT_ENTER_TRANSITION,
  layout: EVENT_LAYOUT_TRANSITION,
}}
```

Reduced motion retains feedback but removes movement:

```tsx
initial={{ opacity: 0 }}
animate={{ opacity: 1 }}
layout={false}
transition={{ opacity: REDUCED_EVENT_ENTER_TRANSITION }}
```

Wrap each streamed event map in `AnimatePresence initial={false}` so historical
rows do not replay entry animation on initial render or when an accordion opens.
Do not stagger streamed events. Do not animate event-row height. For existing
tool/group/actor/work-log disclosures, reduced motion must fade opacity for
120ms while keeping height at `auto` on initial, animate, and exit states; normal
motion can retain the existing 220ms height and 160ms opacity behavior.

Use the first call row ID as the display-item ID for both the singleton and
repeated group so React retains the outer animated wrapper during
singleton-to-group conversion.

## Repo conventions to follow

- `src/components/ChatBox/BottomBox/index.tsx:42-51` defines the existing crisp
  product motion convention: `[0.32, 0.72, 0, 1]`, 180ms entry, 120ms reduced
  opacity entry, and 220ms layout settling. Match these values exactly.
- `src/components/ChatBox/BottomBox/index.tsx:119` normalizes
  `useReducedMotion()` with `Boolean(...)`; use the same pattern once in
  `NormalRunWorkLog` and pass the boolean down.
- `src/components/ui/ShinyText/ShinyText.css:28-33` already disables shimmer for
  `prefers-reduced-motion`; do not change the shared ShinyText component or CSS.
- Keep Framer Motion, Tailwind design tokens, and the current accordion markup.
  No new animation dependency is needed.

## Steps

1. In `src/components/ChatBox/TimelineModes/NormalTimeline.tsx`, import
   `useReducedMotion` from `framer-motion`. Add the exact entry, reduced-entry,
   and layout transition constants from the Target section next to
   `CONTENT_EASE` and `HEIGHT_MOTION`.
2. Add a pure exported helper named `latestRunningNormalToolRowId` that accepts
   `readonly NormalWorkRowItem[]` and `runActive`. Return `null` when the run is
   inactive. Otherwise inspect only `row.kind === 'tool'` rows whose invocation
   status is `running` or `pending`, and return the row ID with the greatest
   `row.runSequence`; use `>=` so the later row wins ties.
3. Compute this ID once in `NormalRunWorkLog` from the Run-wide `rows` and
   `active`. Pass it through flat rendering and every Workforce actor group so
   interleaved agents still share one run-wide current tool.
4. Split `NormalToolRow` state into `running` and `highlighted`. Pass the tool
   row ID into it. `running` is the Run-active plus pending/running predicate and
   controls the waiting-response copy. `highlighted` additionally requires the
   row ID to equal the Run-wide latest ID and controls ShinyText and automatic
   expansion. Add `data-normal-tool-highlighted="true"` only to the highlighted
   tool container for focused tests.
5. Remove ShinyText from generic `activity` rows. Render their text in
   `text-ds-text-neutral-default-default`, except for existing error statuses,
   which remain in the error token. Remove ShinyText from Workforce actor
   headings; use default text for an active group and the existing muted text
   for an inactive group.
6. In `NormalEventGroup`, determine whether the group contains the Run-wide
   highlighted row. When closed, its title uses ShinyText as the sole visible
   proxy. When open, render the title statically and pass the latest ID to child
   rows so only the matching child shimmers. Never render the header and child
   shimmer simultaneously.
7. Change the repeated group display-item ID from
   `normal-event-group:${item.row.id}` to `item.row.id`. Do not change the
   `data-normal-event-group` attributes or grouping rules.
8. Add a shared `NormalAnimatedDisplayRow` wrapper around
   `NormalDisplayRow`. It must use the exact normal/reduced motion in the Target
   section, carry `data-normal-event-motion="standard"` or `"reduced"`, and be
   keyed by `item.id`. Put `AnimatePresence initial={false}` immediately around
   both the Single Agent map and the map inside each Workforce actor group.
9. Call `Boolean(useReducedMotion())` once in `NormalRunWorkLog`, pass the value
   through the display components, and apply the reduced disclosure behavior
   described in Target to tool details, repeated-group bodies, actor bodies,
   and the work-log body. Do not remove opacity feedback.
10. In `test/unit/components/ChatBox/TimelineModes.test.tsx`, add focused tests:
    - two concurrent running tools select only the greatest `runSequence`; there
      is exactly one `.shiny-text`, only that tool has
      `data-normal-tool-highlighted="true"`, both tools keep running semantics,
      and highlight hands off after rerender when the latest completes;
    - a running `work_log` or `task` activity with the text “Searching for
      README files in the project” has
      `text-ds-text-neutral-default-default`, lacks the subtle token, and is not
      `.shiny-text`;
    - a repeated running group has exactly one shimmer: the closed group header,
      then the matching child after expansion;
    - Single Agent and Workforce event items have the standard motion marker;
    - rerendering one matching tool into two matching tools preserves the same
      outer motion-wrapper DOM node while its content becomes an event group;
    - mock `useReducedMotion` true for one render and assert reduced markers.
11. Preserve motion on first-live lifecycle edges without replaying historical
    rows. Keep `NormalRunWorkLog` mounted while empty by returning an outer
    `AnimatePresence initial={false}` and conditionally mounting a keyed motion
    root for the work-log shell with the same standard/reduced event-entry
    values. Wrap the Workforce actor map in another persistent
    `AnimatePresence initial={false}` and wrap each actor in a stable keyed
    motion entry/layout root. This makes an empty-to-first work log and a later
    new Workforce actor animate as units, while their newly mounted nested event
    lists remain `initial={false}` to prevent double motion. Add rerender tests
    for both lifecycle edges and dedicated run/actor motion markers.
12. Format only the two changed frontend files. Do not alter unrelated dirty
    worktree content.

## Boundaries

- Do NOT edit any backend file, Python file, API payload, event schema, or
  transport contract.
- Do NOT edit `src/components/ui/ShinyText/*`; its continuous animation and CSS
  reduced-motion branch are already correct.
- Do NOT edit Detailed or Summarized modes.
- Do NOT change event ordering, actor attribution, grouping criteria, permission
  placement, input placement, or tool request/response contents.
- Do NOT add dependencies.
- Preserve all unrelated user changes in the dirty worktree.
- If a step does not match the current code at commit `85af2129`, stop and report
  the drift instead of improvising.

## Verification

- **Mechanical**:
  - `npx vitest run test/unit/components/ChatBox/TimelineModes.test.tsx` passes.
  - `npx eslint src/components/ChatBox/TimelineModes/NormalTimeline.tsx test/unit/components/ChatBox/TimelineModes.test.tsx --no-warn-ignored` passes.
  - `npx prettier --check src/components/ChatBox/TimelineModes/NormalTimeline.tsx test/unit/components/ChatBox/TimelineModes.test.tsx animation-plans/001-smooth-current-timeline-event.md` passes.
  - `npm run type-check` passes.
  - `git diff --check -- src/components/ChatBox/TimelineModes/NormalTimeline.tsx test/unit/components/ChatBox/TimelineModes.test.tsx animation-plans` passes.
  - `git status --short backend` and `git diff --stat -- backend` show no backend
    changes.
- **Feel check**: run the app and stream a Single Agent task, then a Workforce
  task with interleaved agents. Confirm:
  - only the latest running tool visibly shimmers;
  - when a repeated group opens, shimmer transfers from its header to one child;
  - reasoning/activity copy stays at normal foreground contrast;
  - one new event fades upward by 6px without replaying older events or delaying
    chronology;
  - a singleton tool becoming a group does not flash, reset, or remount visibly;
  - rapid event arrivals remain interruptible and settle without oscillation.
  - In DevTools, set playback to 10% and confirm existing rows settle over 220ms
    while the new row enters over 180ms with no height interpolation.
  - Toggle `prefers-reduced-motion` in the Rendering panel and confirm entry and
    disclosures retain a 120ms opacity fade while translation, layout settling,
    height interpolation, and shimmer movement are absent.
- **Done when**: the focused tests and checks pass, there is exactly one visible
  current-tool shimmer per active run, reasoning/activity text is default color,
  streamed events enter smoothly in both modes, reduced motion removes movement,
  and no backend path is changed.

## Review result

- **Verdict**: APPROVED
- The post-execution review confirmed that first-live work-log insertion and
  later Workforce actor insertion animate through persistent presence
  boundaries, while nested `initial={false}` boundaries prevent historical-row
  replay and double animation.
