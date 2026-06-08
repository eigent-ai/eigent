---
name: animation-interface-demo
description: Generate a self-contained TSX + CSS Module looping interface animation demo. Use when the user describes a workflow, product process, or UI flow that should be visualized as an animated interface preview on the Eigent website.
---

# Animation Interface Demo Generator

## Goal

Generate a complete, self-contained looping interface animation demo as three files:

1. `{Name}Display.tsx` — server-renderable React component (structure + data attributes)
2. `{Name}Cycler.tsx` — client-side animation island (DOM mutations only, no re-renders)
3. `{Name}Display.module.css` — all styles, no Tailwind, no CSS variables from the host app

Output files go in `animation/` at the project root.

---

## Workflow

When the user describes a workflow or process:

1. **Parse the workflow** into a flat ordered list of tasks (typically 3–6). Each task belongs to an agent or role.
2. **Identify agents/roles** and their tools/capabilities (shown as tags).
3. **Decide on interface layout** — the canonical layout has a left chat panel + right workspace with agent cards.
4. **Generate all three files** at once.

---

## Architecture Rules

### No dependencies
- Only `react`, `react/jsx-runtime`, `next/image` (for workspace previews), and `lucide-react` icons are allowed.
- No Tailwind classes. No CSS variables from the host project. No `framer-motion`. No state management.
- The `Display` component must be fully server-renderable (no `"use client"` directive).
- The `Cycler` component gets `"use client"` and is the ONLY interactive island.

### Responsive scaling shell
Every display uses this exact scaling pattern:

```css
.container {
  position: relative;
  width: 100%;
  aspect-ratio: 1600 / 960;           /* matches the inner canvas */
  container-type: inline-size;
  --ui-scale: calc(100cqw / 1600px);  /* scales everything proportionally */
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  touch-action: pan-y;
}

.inner {
  position: absolute;
  top: 0; left: 0;
  width: 1600px;
  height: 960px;
  transform-origin: top left;
  transform: scale(var(--ui-scale, 1));
  /* …border, background, overflow: hidden */
}
```

The inner canvas is always **1600×960 px** at design scale. The container scales it to fill whatever width the parent provides. All child sizes use plain `px` values — they scale automatically.

### Animation data attributes

The Cycler drives the animation entirely via `data-*` attribute mutations and `textContent` updates. No React state. No re-renders.

| Attribute | Where | Purpose |
|-----------|-------|---------|
| `data-cycle-root` | root container | Cycler `querySelector` anchor |
| `data-task-index={n}` | each task item | Marks the task's global index (0-based) |
| `data-done="true\|false"` | each task item | CSS toggles icon + background |
| `data-cycle-summary="done\|ongoing"` | badge text `<span>` | Cycler updates count text |
| `data-cycle-chip="done\|ongoing"` | filter chip `<span>` | Wrapper for per-agent chip |
| `data-agent-indexes="0,1"` | filter chip | Comma-separated global task indexes this agent owns |
| `data-cycle-count="done\|ongoing"` | count `<span>` inside chip | Cycler updates count text |

### CSS icon toggle pattern

Both the "done" and "ongoing" icons are always in the DOM. CSS hides the inactive one:

```css
.iconDone, .iconOngoing { display: none; }
.taskItem[data-done="true"]  .iconDone    { display: inline-block; }
.taskItem[data-done="false"] .iconOngoing { display: inline-block; }
```

The Cycler only sets `el.dataset.done = idx < step ? "true" : "false"` — no class toggling needed.

---

## Display Component Template

```tsx
// {Name}Display.tsx  (NO "use client" — server-renderable)
import Image from "next/image";
import { /* lucide icons */ } from "lucide-react";
import s from "./{Name}Display.module.css";
import {Name}Cycler from "./{Name}Cycler";

const TOTAL_TASKS = N; // total number of animated tasks

function TaskItem({ done, text, index }: { done?: boolean; text: string; index: number }) {
  return (
    <div className={s.taskItem} data-done={done ? "true" : "false"} data-task-index={index}>
      <div className={s.taskIcon}>
        <CircleCheckBig size={16} color="#00a63e" className={s.iconDone} />
        <Loader2 size={16} color="#155dfc" className={`${s.spinner} ${s.iconOngoing}`} />
      </div>
      <p className={s.taskText}>{text}</p>
    </div>
  );
}

export default function {Name}Display() {
  const completedTaskCount = 2; // initial snapshot for SSR
  const isTaskDone = (i: number) => i < completedTaskCount;
  const getDoneCount = (indexes: number[]) => indexes.filter(isTaskDone).length;
  const getOngoingCount = (indexes: number[]) => indexes.length - getDoneCount(indexes);

  return (
    <div className={s.container} data-cycle-root aria-hidden="true">
      <{Name}Cycler totalTasks={TOTAL_TASKS} />
      <div className={s.inner}>
        {/* … layout … */}
      </div>
    </div>
  );
}
```

---

## Cycler Component Template

The Cycler template below is reusable across all demos. Copy it verbatim and adjust only:
- `CYCLE_MS` — how long each step holds (default 1500ms)
- `PAUSE_AT_FULL_MS` — pause when all tasks done before resetting (default 1800ms)
- `ROOT_MARGIN` — IntersectionObserver margin for early wake-up (default "200px")

```tsx
"use client";
import { useEffect, useRef } from "react";

const CYCLE_MS = 1500;
const PAUSE_AT_FULL_MS = 1800;
const ROOT_MARGIN = "200px";

export default function {Name}Cycler({ totalTasks }: { totalTasks: number }) {
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const root = anchor.closest<HTMLElement>("[data-cycle-root]");
    if (!root) return;

    const taskItems = Array.from(root.querySelectorAll<HTMLElement>("[data-task-index]"));
    const summarySpans = Array.from(root.querySelectorAll<HTMLElement>("[data-cycle-summary]"));
    const chipCountSpans = Array.from(root.querySelectorAll<HTMLElement>("[data-cycle-count]"));
    if (taskItems.length === 0) return;

    let step = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let isVisible = true;
    let isTabVisible = !document.hidden;

    const applyStep = () => {
      for (const el of taskItems) {
        const idx = Number(el.dataset.taskIndex);
        el.dataset.done = idx < step ? "true" : "false";
      }
      for (const el of summarySpans) {
        const role = el.dataset.cycleSummary;
        if (role === "done") el.textContent = String(step);
        else if (role === "ongoing") el.textContent = String(totalTasks - step);
      }
      for (const el of chipCountSpans) {
        const chip = el.closest<HTMLElement>("[data-cycle-chip]");
        const indexesAttr = chip?.dataset.agentIndexes;
        if (!chip || !indexesAttr) continue;
        const indexes = indexesAttr.split(",").map(Number);
        const doneCount = indexes.filter((i) => i < step).length;
        const role = el.dataset.cycleCount;
        el.textContent = String(role === "done" ? doneCount : indexes.length - doneCount);
      }
    };

    const tick = () => {
      if (!isVisible || !isTabVisible) { timer = setTimeout(tick, CYCLE_MS); return; }
      step = (step + 1) % (totalTasks + 1);
      applyStep();
      timer = setTimeout(tick, step === totalTasks ? PAUSE_AT_FULL_MS : CYCLE_MS);
    };

    step = 0;
    applyStep();

    let idleHandle: number | null = null;
    let idleTimeout: ReturnType<typeof setTimeout> | null = null;
    const start = () => { timer = setTimeout(tick, CYCLE_MS); };
    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(start, { timeout: 2500 });
    } else {
      idleTimeout = setTimeout(start, 500);
    }

    const io = new IntersectionObserver(([e]) => { isVisible = e.isIntersecting; }, { rootMargin: ROOT_MARGIN });
    io.observe(root);
    const onVisibility = () => { isTabVisible = !document.hidden; };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timer !== null) clearTimeout(timer);
      if (idleHandle !== null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleHandle);
      if (idleTimeout !== null) clearTimeout(idleTimeout);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [totalTasks]);

  return <span ref={anchorRef} aria-hidden="true" style={{ display: "none" }} />;
}
```

---

## CSS Module Guidelines

### Required sections (include all)

```
/* ── Responsive scaling shell ─── */
.container, .inner

/* ── Top Bar ─── */
.topBar, .trafficLights, .dot, .dotRed/Yellow/Green, .topBarNav, .navBackBtn, .navTitleBtn, .navTitleText, .topBarIconGroup, .iconBtn

/* ── Body ─── */
.body, .mainContent (12-col grid, 4-row grid)

/* ── Chat Panel (col 1–3) ─── */
.chatPanel, .chatHeader, .chatTitle, .tokenBadge, .tokenText
.chatContent, .userMessage, .userMessageText, .userMessageLink
.agentMessage, .agentMessageText, .thinkingRow, .thinkingText
.taskCard, .taskCardInner, .progressBar, .progressFill
.taskCardBody, .taskCardTitle, .taskCardMeta, .taskCardBadges
.taskBadge, .taskBadgeText, .taskBadgeTextBlue, .taskCardChevronBtn
.chatScrollbar, .chatBottomBar (input area)

/* ── Workspace Area (col 4–12) ─── */
.workspaceArea, .workspaceTopBar, .workspaceTabs, .wsTab, .wsTabActive, .newWorkerBtn

/* ── Agent Cards ─── */
.agentCardsArea, .agentCard, .agentCardCustom
.agentCardHeader, .agentCardTitleRow, .agentCardTitle
.agentTitleBlue/Green/Orange/Gray, .agentCardMenuBtn
.agentCardTags, .agentTag

/* ── Task items ─── */
.taskFiltersSection, .taskFiltersDivider, .taskFilters
.filterChip, .filterChipActive, .filterChipDefault, .filterChipGreen, .filterChipBlue
.taskListSection, .taskItem, .taskItem[data-done="true"]
.iconDone, .iconOngoing (display:none pattern)
.taskIcon, .taskText, .cardScrollbar

/* ── Bottom Menu Bar ─── */
.menuBar, .menuBarCenter, .botIconBtn, .botBadge, .menuBarRight, .menuNavBtn

/* ── Spinner ─── */
@keyframes spin + .spinner
```

### Color tokens (use these values, no CSS variables)

| Token | Value |
|-------|-------|
| Text primary | `#111111` / `#222222` |
| Text secondary | `#666666` |
| Text muted | `#cccccc` |
| Border | `#eeeeee` / `#cccccc` |
| Blue accent | `#155dfc` |
| Green accent | `#00a63e` |
| Orange accent | `#e17100` |
| Background card | `#ffffff` |
| Background subtle | `#f5f5f5` |
| Done bg | `#f0fdf4` |
| Progress green | `#016630` |

### Grid layout
```css
.mainContent {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-template-rows: repeat(4, minmax(0, 1fr));
}
.chatPanel     { grid-column: 1 / span 3;  grid-row: 1 / span 4; }
.workspaceArea { grid-column: 4 / span 9;  grid-row: 1 / span 4; }
```

---

## Agent Card Anatomy

Each agent card follows this structure:

```
AgentCard
├── Header (title + MoreHorizontal menu btn)
│   └── Tags row (# Tool1, # Tool2, …)
├── [optional] Workspace preview image
├── Filter chips (All | Done N | Ongoing N)
│   └── Done/Ongoing chips carry data-cycle-chip + data-agent-indexes
└── Task list
    └── TaskItem × n  (data-task-index, data-done)
```

Agent title colors:
- Browser/Web agent → `#0084d1` (blue)
- Developer/Code agent → `#009966` (green)
- Document/Report agent → `#e17100` (orange)
- Custom/placeholder agent → `#222222` (gray) + opacity 0.4

---

## Steps to Generate a New Demo

Given a user's workflow description:

1. **Extract tasks** — write each as a single imperative sentence (1–2 lines, detail OK). Number them globally from 0.
2. **Group tasks by agent** — assign each task to the most fitting agent type. Create 2–4 real agents + 1 ghost "Custom Agent" placeholder.
3. **Set `TOTAL_TASKS`** to the total task count.
4. **Set initial `completedTaskCount`** — pick roughly half (e.g. `TOTAL_TASKS = 4` → start at `2`).
5. **Build `browserTaskIndexes`, `developerTaskIndexes`, etc.** — arrays of global task indexes per agent.
6. **Write the task text** — the existing example uses verbose, realistic task descriptions. Match that tone.
7. **Choose workspace preview** — include a `showPreview` card if the workflow involves web browsing or visual output. Use `/home/demo.png` as placeholder or the appropriate public image path.
8. **Write chat panel content** — user message rephrasing the workflow goal, short agent reply, "Thinking Xs", and the Task card with animated badges.
9. **Generate CSS** — copy the full CSS structure above, adjusting any unique layout needs.
10. **Generate Cycler** — copy verbatim, substituting `{Name}`.

---

## Output Checklist

Before delivering files, verify:

- [ ] `{Name}Display.tsx` has NO `"use client"` directive
- [ ] `{Name}Cycler.tsx` has `"use client"` at top
- [ ] `data-cycle-root` is on the root `<div>` of Display
- [ ] Every `<TaskItem>` has a unique `data-task-index` starting at 0
- [ ] Filter chip `data-agent-indexes` covers all tasks for that agent
- [ ] `TOTAL_TASKS` matches the count of TaskItems across all cards
- [ ] CSS uses `#` hex values only — no `var()` referencing host app tokens
- [ ] `.container` has `aspect-ratio: 1600 / 960` and `container-type: inline-size`
- [ ] `.inner` is 1600×960 with `transform: scale(var(--ui-scale, 1))`
- [ ] `aria-hidden="true"` on root container
- [ ] `pointer-events: none` on root container
- [ ] Spinner animation defined as `@keyframes spin` in the CSS module

---

## Usage

Trigger this skill when the user says things like:
- "Create an interface demo for [workflow]"
- "Build an animation for [process]"
- "Make a website demo showing [product feature]"
- "Add an interface preview for [use case]"

Ask for (or infer from context):
- The workflow name (for file naming)
- The workflow steps / process description
- Any specific agents or tools to feature
- Whether a workspace preview image should be included
