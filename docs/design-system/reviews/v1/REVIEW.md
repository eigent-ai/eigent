# Design system migration review v1

> **Snapshot: 22 Aug 2026.** Branch `design-system-enhancement`, local working
> tree vs [`DESIGN.md`](../../new-design-system-plan/DESIGN.md) and
> [`MIGRATION_PLAN.md`](../../migration-plan/MIGRATION_PLAN.md). Read-only
> review of the plan and the uncommitted implementation.
>
> Counts below are from that day’s tree: 237 `src/` files touched, 3,901
> `ds-*` utility refs, 313 arbitrary geometry leftovers. Usage report generated
> 22 Aug 2026 14:07 on commit `ad806582`; the working tree was ahead of that
> commit.

The plan is a strong destination contract. The local change landed the
foundations, then skipped the staged rollout and was **not ship-ready as one
PR**.

## Verdict

| Measure | That day’s reading |
| --- | --- |
| Ship readiness | Partial |
| `src/` files touched | 237 |
| `ds-*` utility refs | 3,901 |
| Arbitrary geometry left | 313 |
| Staged-contract progress | ~55% of phases 0–7 (weighted by exit criteria, not file count) |

Color consumers looked farther along than they were because most edits were
utility renames, not recipe adoption.

**Do not ship that tree as one PR.** Foundations were real and the three
Phase 0.0 seed defects were fixed. Product code then jumped from “tokens
exist” to a 237-file class rename. Additional primitive and CI review found
dead Settings dots, invisible disabled ghost/text buttons, doubled field
padding, and a clean-tree gate that could not fail because
`src/style/generated` was untracked.

> **Later on the same branch (not part of this snapshot):** inverse text on
> dark Accent fills was added as a required AA contract (§2.2.1) — it was
> missing from this review. Several P1/P2 items below were then fixed in
> follow-up commits. See the branch history, not this file, for current
> status.

## Plan

The architecture is the right one for Eigent: reference → semantic → component
recipe → pattern, with an owned exception list for Electron, Radix, Monaco, and
window chrome. The public color grammar (Accent / Neutral / Ink / Hairline ×
four emphasis levels × four states), the `--ds-{group}-on-{emphasis}`
foreground pairs, and seed admission gates directly fix real bugs: Eigent
light Accent at `#000000` collapsing hover/selected to ΔEOK `0.000`, and dark
Accent strong with a hard-coded white label at 1.65:1.

The migration plan’s “one family, releasable after every phase” rule is the
part the implementation did not follow.

### What the plan gets right

- Layers 1–4 plus an owned exception list. Feature code is supposed to consume
  recipes, not assemble utilities.
- Inverse fill emphasis is replaced by `--ds-{group}-on-{emphasis}`, which is
  the actual fix for dark-mode Accent strong at 1.65:1. *(This review treated
  inverse as a retired fill emphasis. It did not yet require a named inverse
  **text** role for dark brand fills in light mode. That gap was filed after
  this snapshot.)*
- Phase 0.0 correctly treats `#000000` Eigent accent as a bug, not a migration
  item: L=0 collapses hover and selected to ΔEOK 0.
- §3.2.1 and §5.3.1 call out visual diffs instead of hiding them inside a
  rename.

### Where the plan itself was still open

1. **`caution` is not a duplicate of warning.** §2.7.1 merged it into warning.
   The registered seed is `#e7000b` (destructive red), next to error `#dc2626`
   and warning `#d97706`. That is the old `cuation` danger role, not amber.
2. **§3.2.1 still asked for sign-off** on the 10→11px `text.meta` floor,
   dropped 24/36px heading steps, and 22 utilities that never generated CSS.
   The local change applied that map anyway.
3. **The header was stale.** `DESIGN.md` still said product code had not
   migrated. This working tree had.
4. Manifest still published inverse, active, focus, and caution while the
   public contract forbids them. Two contracts will keep leaking into
   generators and scanners.

## Phase completion vs the plan

Weighted by the migration plan’s exit criteria, not file count.

| Phase | Plan exit | Local status | Gap |
| --- | --- | --- | --- |
| 0.0 Seed hotfix | Eigent accent `#1d1d1d`; one seed table; Whale dark | Done in `base.color.json`; onboarding reads accent hex from JSON | Preset IDs/labels still hardcoded; Whale/Custom omitted from onboarding |
| 0 Baseline | Usage report, unresolved-token scanner, clean-tree CI | Scanner + clean-tree + retired-axis check wired in `test.yml` | No named visual fixtures / screenshot gate in this change |
| 1 Tailwind 4 | ESM config, sentinels, no missing utilities | Sentinel job added; 0 removed v3 utilities | `tailwindcss-animate` still the only plugin; no recorded disposition |
| 2 Token foundations | JSON sources, generator, seed admission, on-emphasis pairs | 15 token files; 216 static `--ds-*` vars; `verify:theme` passes | No headroom-aware transform direction; colors still runtime-injected |
| 3 Shared primitives | DsText, DsIcon, Button, form family, then dialogs | Button recipes wired; DsText/DsIcon/DsMorphIcon exist | Those three primitives have zero product imports |
| 4 Color consumers | Intent mapping; retire active/focus/inverse/caution | Bulk `ds-*` rename across Chat, Settings, Layout, Session | caution still generated; `focus:`/`active:` still used as fills |
| 5 Geometry | Named recipes; exception allowlist only | Recipes exist for button/field/header | 313 arbitrary geometry refs remain; Input still `rounded-xl` |
| 6 Surfaces + a11y | Markdown profiles, semantic HTML, Electron QA | Class-level color swap on many surfaces | No Markdown profile unification; no 200% zoom / coarse-pointer evidence |
| 7 Remove compat | Zero legacy aliases except owned exceptions | Compat maps in `tokenAliases.ts` still required | No owner, no removal milestone, unused layout alias map |

## Local change that matched the plan

Phase 0.0 and Phase 2 foundations were in good shape:

| Contract | Evidence |
| --- | --- |
| Eigent light accent is brand `#1d1d1d` | `base.color.json` `light.eigent.accent` |
| Dark Eigent ink is the recommended warm `#f2ece8` | `base.color.json` `dark.eigent.ink` |
| Whale dark is authored, not a copy of light | `dark.whale` background `#111111` / ink `#fcfcfc` |
| Hover dL −0.07, selected dL −0.10 | `semantic.color.json` transforms; `seedAdmission.ts` gates 0.06 / 0.08 |
| Onboarding presets no longer hard-code accent hex | `OnboardingSteps.tsx` uses `getOnboardingThemePresets()` |
| Button md is 32px / 16px icon / pill / on-strong foreground | `button.tsx` `SIZE_TEXT.md` + `TONE_PRIMARY` using `--ds-accent-on-strong` |
| CI enforces generation + retired axes | `test.yml`: `check:design-tokens`, `verify:tailwind4`, clean-tree |
| `status-warning` ghost token is gone from product source | No matches in `src/`; scanner requirement from §14.5 landed |

Then ~237 `src/` files were rewritten in the same tree. That is a class-name
sweep, not Phase 3–4.

## Findings

Defect-first. Each item was in the local diff that day, actionable, and
something the author would likely change if they saw it. Line numbers refer to
that working tree.

### P1

| Finding | Where | Why it is wrong |
| --- | --- | --- |
| Settings model status dots use dead CSS variables | `Settings/Models/index.tsx:2417–2419` | `bg-text-success` / `bg-text-label` map to `var(--text-success)` and `var(--text-label)`. Those vars were removed from `token.css` and only exist inside `formControlTokenAliases`, which this page never applies. Configured dots render transparent. |
| Ghost and text buttons have no disabled visual | `button.tsx` `TONE_GHOST` / `TONE_TEXT` | Base class dropped `disabled:opacity-50` and kept only `disabled:pointer-events-none`. Primary/outline get disabled fills; ghost and text do not. A disabled ghost/text button is pixel-identical to enabled. Violates §2.3 and §13. |
| Delete control paints muted ink on an error fill | `ChatBox/TaskBox/TaskItem.tsx` | Button is variant primary tone error. Sibling `Check` uses `text-current`; `Trash2` uses `text-ds-ink-muted-default`. Lucide uses `currentColor`, so the icon class wins and contrast on the strong error fill fails. |
| `caution` destination disagrees with itself | `tone.assignment.json` vs `button.tsx` vs `tag.tsx` | Plan and `tone.assignment` merge caution into warning. Button and AlertDialog map it to error. The seed is `#e7000b` (destructive red), not warning amber. Pick one destination and stop generating a full caution matrix. |
| Clean-tree CI cannot fail until generated files are tracked | `check-design-system-clean-tree.mjs` | The gate is `git diff --exit-code` on `src/style/generated`. That directory was still untracked, so `git diff` is empty and the step passes even if artifacts drift. Commit the generated outputs or the §14.5 gate is vacuous. |

### P2

| Finding | Where | Why it is wrong |
| --- | --- | --- |
| Input/Textarea double the field inset | `formFieldSurface.ts` + `input.tsx` | Wrapper now has `!px-ds-12` (12px). Inner input still has `pl-3`/`pr-3` (12px). Net text inset is 24px vs Field recipe 12px. Leading icon at `left-2` no longer lines up with text. |
| Button md padding is 16px, plan says 10px | `component.recipe.json` vs DESIGN.md §5.3 | Approved table: md height 32, icon 16, gap 8, inline padding 10. Recipe uses space-16. sm is 8 vs 10; lg is 16 vs 14. The spacing scale has no 10/14 step, so the recipe snapped to the scale instead of the spec. |
| `shadow-perfect` was renamed out from under Tailwind | `token.css` vs `tailwind.config.js` | `--shadow-perfect` became `--shadow-ds-elevation-popover`, which nothing consumes. `.shadow-perfect` still emits `var(--shadow-perfect)` and is now undefined. Real popover elevation comes from generated `--ds-elevation-popover`, a different 2-layer recipe. |
| Unresolved-token scanner only covers six prefixes | `build-token-usage-report.mjs` | §14.5 requires every `ds-*` utility to resolve. The scanner validates `bg\|text\|border\|ring\|fill\|stroke` only. `shadow-ds-*`, `rounded-ds-*`, `h-`/`w-`/`size-ds-*`, `gap-ds-*` are collected or used and never cross-checked. |
| SelectItem left off the menu-row recipe | `select.tsx` | Dropdown/Popover items got `min-h-ds-control-lg rounded-ds-menu-row`. SelectItem still uses `rounded-xl`, `text-sm`, no min-height, and a Neutral separator instead of Hairline. |
| `focus:` and `active:` still used as color states | `menu-button.tsx`, `select.tsx`, BottomBox pickers | Public matrix is default / hover / disabled / selected. Focus is a ring. Pressed is elevation. Tailwind safelist still generates `focus:`/`active:` fill utilities, which keeps the retired axis alive. |
| Layer-3 primitives never adopted | `ds-text.tsx`, `ds-icon.tsx`, `ds-morph-icon.tsx` | Phase 3 starts with typography and icon wrappers. Feature code still uses `text-ds-text-*` utilities and raw Lucide size props. DsText’s code channel also ignores the `role` prop and never renders `code`/`pre`. |
| Compat aliases have no owner or removal date | `tokenAliases.ts` | `productLayoutTokenAliases` is never imported. Leftover `bg-text-*` classes only resolve when a parent injects the alias map. |

### P3

| Finding | Where | Why it is wrong |
| --- | --- | --- |
| Transform direction is not seed-aware | `engine.ts` `applyAdjustment` / `semantic.color.json` | §2.5.1 requires choosing darken vs lighten by gamut headroom. The engine always applies dL −0.07 / −0.10. That works for Eigent’s near-black and beige seeds; it is not the specified contract for chromatic seeds that need to lighten. |

Leftover `ds-bg-brand` / `--ds-text-brand-*` / `bg-ds-icon-neutral-*` call
sites still resolved through the runtime matrix, so they were leftovers against
the public Accent/Ink contract, not dead variables.

## Checks that already passed

- `check-retired-ds-axes` and `check-css-writing-standard` pass. No remaining
  `text-text-*`, `status-warning`, or `text-cuation` in `src/`.
- Theme verifier reports 60 variants, 0 findings, at default contrast. Eigent
  light hover/selected no longer collapse.
- Exception registry has 12 owned entries covering AppShell, Electron guest
  rect, Radix collision, Monaco/xterm, and window controls.

## Residual risk if that tree landed as-is

- Visual regression is unmeasured. md/lg buttons drop icons 24→16px across the
  product in the same diff as a 237-file color rename.
- Compatibility aliases are one-way in comments but still the only way leftover
  `bg-text-*` classes resolve — and they only resolve when a parent injects the
  alias map.
- Typography user settings (11–16px text, 8–24px code) are specified and
  generated as roles, but there is no product settings UI or runtime seed
  wiring in this change.

## Recommended split (that day’s advice)

Keep the architecture. Re-cut the working tree so each PR can fail
independently, matching the plan’s rollback rules.

| Slice | Scope |
| --- | --- |
| PR 1 | Seeds, generator, seed admission, CI clean-tree. No product surfaces. |
| PR 2 | Button + form family only. Fix padding to the §5.3 table. Add stories and light/dark screenshots. |
| PR 3 | Adopt DsText / DsIcon on primitives, then one vertical slice (Settings or Chat), not both. |
| Now | Fix Settings dots, ghost/text disabled, TaskItem icon contrast, field double-padding, and commit generated tokens so clean-tree can actually fail. Decide caution → error vs warning first. |

Record the three open design decisions (`text.meta` floor, heading steps,
caution destination) in `DESIGN.md` so the plan and the code stop disagreeing.

## Omission recorded after this review

This review did not call out **inverse text on dark brand fills**. Eigent
light Accent is `#1d1d1d`. Default Ink on that fill is 1:1. The shipping
product used `--text-inverse-primary` / `emphasis="inverse"` so primary
labels pass WCAG AA. Inverse as a *fill emphasis* is correctly retired;
inverse as a *foreground* is required. That contract was added to DESIGN.md
§2.2.1 after this snapshot (`--ds-ink-inverse` as an alias of
`--ds-accent-on-strong`).
