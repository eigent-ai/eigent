# Theme Tokens V2

Theme Tokens V2 is a full cutover to a DTCG-driven, OKLCH-based token engine.

## Architecture

1. **Canonical token sources** in `/tokens`:
   - `base.color.json` (theme seeds + fixed role anchors)
   - `semantic.color.json` (axes + transforms + contrast policy)
   - `component.color.json` (component/global alias vars)
   - `contracts/*.json` (contract presets with `$extends`)
2. **Compiler pipeline** in `engine.ts`:
   - DTCG parse
   - `$extends` resolution
   - Semantic generation (`tone × emphasis × state × element`)
   - WCAG contrast enforcement
   - APCA diagnostics emission
   - CSS variable emission (`--ds-*` + component aliases)
3. **Runtime application** in `ThemeProvider` via `applyThemeContractV2`.

## Contract

```ts
type Adjustment = { dL?: number; dC?: number; dH?: number; alpha?: number };
type ThemeContractV2 = {
  version: 2;
  mode: "light" | "dark";
  themeId: string;
  contrast: number; // 0..100
  overrides?: {
    tone?: Record<Tone, Adjustment>;
    emphasis?: Record<Emphasis, Adjustment>;
    state?: Record<State, Adjustment>;
    cell?: Record<`${Tone}.${Emphasis}.${State}`, Adjustment>;
  };
};
```

Override precedence is deterministic:

1. tone defaults
2. emphasis transform
3. state transform
4. axis overrides (`tone`, `emphasis`, `state`)
5. cell override (`tone.emphasis.state`)

## Developer API

In development, `ThemeProvider` exposes:

```js
window.__eigentThemeV2.listThemes(); // { light: [...], dark: [...] }
window.__eigentThemeV2.setTheme("light", "starfish");
window.__eigentThemeV2.setContrast(65);
window.__eigentThemeV2.getState();
```

## Validation

- WCAG AA is enforced by default on required semantic pairs.
- APCA scores are emitted as diagnostics (non-blocking).
- Engine tests live in `engine.v2.test.ts` and cover:
  - determinism
  - override precedence
  - gamut-safe outputs
  - contrast enforcement
  - randomized seed stability
  - runtime reapplication behavior
