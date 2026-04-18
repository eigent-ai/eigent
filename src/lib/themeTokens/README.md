# Theme Tokens V2

This module introduces a new semantic token system based on:

`element.tone.emphasis.state`

Example: `bg.status-running.subtle.default`

## Goals

- Keep user-facing controls small: mode + theme id + single contrast scalar.
- Derive most UI color decisions from seeds (`accent`, `background`, `ink`) and `contrast`.
- Make task lifecycle states first-class semantics (running, splitting, pending, error, reassigning).
- Keep components token-driven (no hardcoded color values).

## Token Layers

1. Theme contract (`ThemeContractV1`)
2. Theme seed (`accent`, `background`, `ink`)
3. Derived tokens (`buildThemeV1`)
4. Semantic tokens (`element.tone.emphasis.state`)
5. Component aliases (component-local CSS variables referencing semantic tokens)

## Naming Contract

- `element`: `bg`, `text`, `border`, `icon`, `ring`
- `tone`:
  - global: `neutral`, `brand`
  - task states: `status-running`, `status-splitting`, `status-pending`, `status-error`, `status-reassigning`, `status-completed`, `status-blocked`, `status-paused`, `status-skipped`, `status-cancelled`
  - fixed tones: `single-agent`, `workforce`, `browser`, `terminal`, `document`, `success`, `caution`, `warning`, `information`
- `emphasis`: `subtle`, `muted`, `default`, `strong`, `inverse`
- `state`: `default`, `hover`, `active`, `selected`, `focus`, `disabled`

## Surface Level Mapping

Legacy surface levels should map to V2 semantic naming:

- `surface-primary` -> `bg.neutral.subtle.default`
- `surface-secondary` -> `bg.neutral.default.default`
- `surface-tertiary` -> `bg.neutral.strong.default`

All surface tokens are generated as solid fills (not opacity overlays).

## Fixed Tone Tokens

Fixed tones are generated in the same `--ds-*` graph but are not derived from user seed colors.  
They currently use the original light/dark values from `token.css` as a migration baseline.

Fixed-tone palette source (developer-owned, not user-editable):

- `src/lib/themeTokens/fixedToneSchema.ts`
- Edit `DEFAULT_FIXED_TONE_SCHEMA` to set the base tone colors.
- The engine derives hover/active/focus/selected state tokens from these base colors.

Examples:

- `--ds-text-success-default-default`
- `--ds-border-warning-default-default`
- `--ds-icon-browser-default-default`
- `--ds-bg-single-agent-subtle-selected`

## Direct Tailwind Usage

`tailwind.config.js` registers semantic `--ds-*` color entries so you can use token classes directly:

- `text-ds-text-success-default-default`
- `hover:text-ds-text-success-default-hover`
- `bg-ds-bg-warning-subtle-selected`
- `border-ds-border-browser-default-focus`

## How To Search Token Usage

Use ripgrep to track usage in code and styles:

```bash
rg "var\\(--ds-" src
rg "status-running|status-splitting|status-pending|status-error" src
rg "--task-fill-|--badge-|--surface-(information|success|warning|cuation)" src/style tailwind.config.js
```

Search strategy:

1. Search semantic tokens first (`--ds-*`).
2. Search legacy tokens from `legacyMapping.ts`.
3. Migrate component aliases before touching component internals.

## How To Select Tokens For Components

For each component area, pick tokens in this order:

1. Base layer:
   - background: `bg.neutral.*`
   - text/icon: `text.neutral.*`, `icon.neutral.*`
   - border/ring: `border.neutral.*`, `ring.*`
2. Interactive state:
   - hover/active/focus from same tone/emphasis family.
3. Domain state (task lifecycle):
   - use `status-*` tones for task chips, cards, rows, progress markers.

Rules:

- Do not mix unrelated tones in one control unless intentional.
- Prefer `subtle` backgrounds and `strong` text for status badges.
- Use `default` borders and `focus` rings for keyboard state.
- Avoid direct palette tokens (`--colors-*`) in components.

## Semantic Token vs Component Alias

Create semantic tokens when the token expresses stable product meaning:

1. The meaning is reused across multiple components/features.
2. The value should respond consistently to theme mode/contrast.
3. The name is domain-driven, not component-driven (`status-running`, `status-error`).
4. It is part of design language, not local layout implementation.

Create component aliases when the token is local implementation detail:

1. The value is specific to one component’s structure.
2. You need to map several semantic tokens into a simpler component API.
3. You are preserving backwards compatibility during migration.
4. You are tuning only one component without changing global semantics.

Promotion rule:

1. Start with a component alias if unsure.
2. If the same alias pattern appears in 2 or more components, promote to semantic token.

Anti-patterns:

1. Semantic tokens named after a single component (`button-primary-bg`).
2. Component aliases pointing to raw hex values.
3. Creating semantic tokens for one-off visual exceptions.

## How To Create New Component Tokens

Create component-scoped aliases that reference semantic tokens. Example:

```css
.task-row {
  --task-row-bg-default: var(--ds-bg-neutral-default-default);
  --task-row-bg-hover: var(--ds-bg-neutral-default-hover);
  --task-row-border-focus: var(--ds-border-neutral-default-focus);
}

.task-row[data-status='running'] {
  --task-row-bg-default: var(--ds-bg-status-running-subtle-default);
  --task-row-border-focus: var(--ds-border-status-running-default-focus);
}
```

Guidelines:

1. Always define at least `default`, `hover`, and `focus` aliases.
2. Keep aliases local to the component namespace (`--task-row-*`, `--badge-*`).
3. Point aliases to semantic tokens, not to raw color constants.
4. If a status is new, add a new semantic tone in `types.ts` first.

## Runtime Usage

- Build tokens: `buildThemeV1(contract)`
- Apply to root: `applyThemeContractV1(contract, document.documentElement)`

Current integration applies `--ds-*` variables at runtime without replacing old tokens yet.

In development builds, `ThemeProvider` exposes `window.__eigentThemeV1`:

```js
window.__eigentThemeV1.listThemes(); // { light: [...], dark: [...] }
window.__eigentThemeV1.setTheme('light', 'vivid');
window.__eigentThemeV1.setContrast(65);
window.__eigentThemeV1.getState();
```

## Refactor Workflow (Required)

1. Define/adjust base theme seeds first in `catalog.ts` (`accent`, `background`, `ink`).
2. Apply themes and validate semantics across multiple color themes (same component states, different seeds).
3. Fix semantic token mapping issues discovered during theme switching.
4. Only then migrate feature/component token usage.

Why:

- Seed-first validation exposes wrong token selection early (for example neutral vs status tone misuse).
- Switching theme IDs should change appearance without requiring component code changes.

## Migration Notes

- See `MAPPING.md` for old-to-new token migration.
- Keep old token names only as aliases during migration.
- Correct naming drift as part of migration (`spliting` -> `splitting`, `cuation` -> `error/caution`, `tertiery` -> `tertiary`).
