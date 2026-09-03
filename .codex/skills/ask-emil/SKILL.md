---
name: ask-emil
description: A router over the design engineering skills. Ask which one fits the situation in front of you, and which order to run them in. Use when you don't know which skill covers a problem, when two of them seem to overlap, when you want the sequence for building or fixing a whole screen, or when you're not sure a skill applies at all. Triggers on: which skill, what skill should I use, ask emil, which one covers, do you have a skill for, what's the right skill, skill for this, list the skills, what skills do I have, where does this belong, which order.
disable-model-invocation: true
---

# Ask Emil

You don't remember which skill covers what, so ask.

Answer with **one or two skills, not five**. Name them, say in one line why, then run them. Loading four skills at once spreads the agent's attention across four craft bars and it applies none of them properly — the same reason a skill covers one aspect of the interface instead of everything.

## Route in two questions

**1. What phase are you in?** This picks the group. Every skill belongs to exactly one moment in the work, and reaching for the wrong moment is the most common mis-route — polishing something whose layout is still wrong wastes the pass, because the polish gets thrown away with the layout.

| Phase | You're saying | Go to |
| --- | --- | --- |
| Undecided | "try a few", "not sure which", "show me options" | [Decide](#decide) |
| Foundation | "build this screen", "lay this out" | [Start here](#start-here) |
| Pieces | "build this card / form / component / landing page" | [Build](#build) |
| It works, it feels off | "make it feel finished", "this is janky", "on mobile it's broken" | [Refine](#refine) |
| It's done | "does this look right", "review before I ship" | [Check](#check) |
| The words, not the work | "what's it called when…" | [Underneath](#underneath) |

**2. What is the thing?** Inside the group, the skill is named after the material — type, color, surfaces, motion, forms, components. If two of them both look right, the answer is in [Overlaps](#overlaps), not in reading both.

## Decide

- **`/prototype`** — build 3–5 genuinely different versions behind a live picker, with every uncertain number on a control, then write down what got picked and what got rejected. Reach for it the moment a decision hasn't been made yet. **Never run it after the decision is made** — a picker holding three answers to a settled question wastes the run. If the user already knows what they want, skip straight to the building skill.

## Start here

The foundation. Most screens need these three before anything else, and running them after the pieces are built means redoing the pieces.

- **`/design-foundations`** — hierarchy, spacing, alignment, restraint. The default answer to "this screen looks off and I can't say why". Also owns the supporting elements nobody assigns to a skill: button hierarchy, empty states, error messages, microcopy.
- **`/typography`** — font files, variable axes, type scales, line length, wrapping, truncation. Anything where the *text itself* is the problem.
- **`/color`** — OKLCH palettes, tonal scales, dark mode derivation, contrast that actually passes APCA/WCAG. Any time a color value gets invented rather than chosen.

## Build

The pieces that sit on the foundation.

- **`/surfaces`** — shadows, borders, gradients, elevation, and the dark-mode versions of all four. Cards, modals, dropdowns, images.
- **`/component-design`** — the *props API* of a component other people will reuse: composition over configuration, compound components, controlled/uncontrolled. Not how it looks.
- **`/forms-and-inputs`** — forms, inputs, buttons, validation timing, loading and disabled states, submit behavior. Anything a user types into or presses.
- **`/marketing-pages`** — landing pages, blogs, docs, changelogs. Owns what's different about marketing surfaces: motion restraint, SEO, static generation, CTAs. It pulls the foundation skills in rather than replacing them.

## Refine

The screen works. Now it has to feel built.

- **`/animations`** — whether to animate at all, then easing, duration, springs, enter/exit. Motion that looks *wrong*.
- **`/ui-polish`** — the invisible pass: font rendering, tabular numbers, layout shift, hover/focus/pressed states, hit areas, truncation, stacking. Motion that looks *unfinished*.
- **`/performance`** — virtualization, preloading, GPU compositing, layout stability. Anything measured in frames, milliseconds, or scroll jank.
- **`/touch-and-accessibility`** — tap targets, hover vs touch, focus management, aria, reduced motion, iOS Safari quirks. This is a floor, not a refinement — if it fails here it ships broken for someone, so run it even when the screen already looks finished.

## Check

- **`/ui-review`** — point it at a diff, a generated component, or a PR and get findings ranked by how much they hurt. It **reports, it doesn't fix**. Reach for it after an agent builds UI, which is the case it exists for: models produce interfaces that look right in a screenshot and fall apart under a real cursor.

## Underneath

Run beneath the others. Reach for them when the **words**, not the work, are the problem.

- **`/design-vocabulary`** — name a *visual* concept from a loose description ("the space between two specific letters" → kerning). Also settles near-synonyms: badge vs tag, tooltip vs popover.
- **`/engineering-vocabulary`** — name a *behavior* from a loose description ("the UI updates before the server confirms" → optimistic update).
- Both exist because a vague prompt gets a vague interface. Getting the term right before asking for the thing is the cheapest quality win available.

## Standalone

Off the flow entirely.

- **`/ask-lapse`** — Lapse, the animation inspector: installing it, driving the panel, takes, named moments, diffs, jank reports, the MCP and Playwright integrations. Reach for it when you need to *see* what an animation is doing frame by frame. `/animations` decides what the motion should be; `/ask-lapse` is how you look at what it currently is. They pair: inspect with Lapse, fix with `/animations`.
- **`/writing-skills`** — write skill files that actually change what an agent does. Reach for it when the user is packaging their own taste, or when a skill they wrote is being ignored.

## Overlaps

The routes that get confused. Each pair is one question, not two skills to read.

| If you're torn between | Ask | Then |
| --- | --- | --- |
| `design-foundations` / `ui-polish` | Is the layout itself wrong, or right but unfinished? | Wrong → foundations. Unfinished → polish. |
| `ui-polish` / `ui-review` | Do you want it fixed, or told what's wrong? | Fixed → polish. Told → review. |
| `animations` / `performance` | Does it look wrong, or does it drop frames? | Looks wrong → animations. Drops frames → performance. |
| `animations` / `ask-lapse` | Do you know what the motion is doing? | No → Lapse first. Yes → animations. |
| `color` / `surfaces` | Is it the value, or what's built from it? | Palette, contrast, dark-mode values → color. Shadow, border, gradient, elevation → surfaces. |
| `typography` / `design-foundations` | Is the text the subject, or one element in a layout? | Subject → typography. Element → foundations. |
| `component-design` / everything visual | Is the problem the props, or the pixels? | Props → component-design. Pixels → the matching visual skill. |
| `touch-and-accessibility` / `ui-polish` | Is it broken for someone, or merely unpolished? | Broken → touch-and-accessibility, and it's blocking. |
| `prototype` / any building skill | Has the decision been made? | No → prototype. Yes → build the one thing. |
| `design-vocabulary` / `engineering-vocabulary` | Can you see it, or does it happen? | See → design. Happens → engineering. |

## Stacking

Real work runs two or three in sequence, never in parallel.

- **New screen** → `/design-foundations`, then the material skill for whatever it's made of, then `/ui-review` before it ships.
- **New component** → `/prototype` if undecided → build → `/animations` if it moves → `/touch-and-accessibility`.
- **"Feels cheap"** → `/ui-polish` first. It's the highest hit rate on that complaint. Only escalate to `/design-foundations` if the polish pass finds the structure is the problem.
- **"Feels slow"** → `/performance`, not `/animations`. Slowness is measured; motion taste is judged.
- **Landing page** → `/marketing-pages`, which brings the rest in itself.

## When nothing fits

Say so. These skills cover the interface — layout, type, color, surfaces, motion, components, forms, accessibility, performance. They do not cover backend logic, data fetching, state management, build tooling, or testing. Stretching `/design-foundations` over a database question produces confident nonsense, and the user can't tell it apart from a real answer. Answer normally instead, and say no skill applies.
