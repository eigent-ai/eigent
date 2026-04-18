// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { DEFAULT_THEME_CATALOG, getColorThemeDefinition } from './catalog';
import { alpha, chooseReadableText, clamp, mix } from './colorMath';
import {
  DEFAULT_FIXED_TONE_SCHEMA,
  type FixedToneSchema,
  type FixedToneSeed,
} from './fixedToneSchema';
import { tokenKeyToCssVarName } from './naming';
import type {
  FixedTone,
  Mode,
  ResolvedThemeV1,
  StatusTone,
  ThemeCatalog,
  ThemeContractV1,
  ThemeTokens,
  TokenKey,
} from './types';

const STATUS_TONES: StatusTone[] = [
  'status-running',
  'status-splitting',
  'status-pending',
  'status-error',
  'status-reassigning',
  'status-completed',
  'status-blocked',
  'status-paused',
  'status-skipped',
  'status-cancelled',
];

type RuntimeStatusTone = Record<StatusTone, `#${string}`>;
type NeutralTokenElement = 'bg' | 'text' | 'border' | 'icon' | 'ring';

const NEUTRAL_EMPHASIS = [
  'subtle',
  'muted',
  'default',
  'strong',
  'inverse',
] as const;
const UI_STATES = [
  'default',
  'hover',
  'active',
  'selected',
  'focus',
  'disabled',
] as const;

type NeutralEmphasis = (typeof NEUTRAL_EMPHASIS)[number];
type UiState = (typeof UI_STATES)[number];
type NeutralStateMatrix = Record<NeutralEmphasis, Record<UiState, string>>;

function setTokenIfMissing(
  tokens: ThemeTokens,
  tokenKey: TokenKey,
  value: string
): void {
  if (!(tokenKey in tokens)) {
    tokens[tokenKey] = value;
  }
}

function ensureNeutralMatrix(
  tokens: ThemeTokens,
  element: NeutralTokenElement,
  matrix: NeutralStateMatrix
): void {
  for (const emphasis of NEUTRAL_EMPHASIS) {
    for (const state of UI_STATES) {
      setTokenIfMissing(
        tokens,
        `${element}.neutral.${emphasis}.${state}` as TokenKey,
        matrix[emphasis][state]
      );
    }
  }
}

function resolveStatusToneBase(
  accent: `#${string}`,
  ink: `#${string}`,
  background: `#${string}`
): RuntimeStatusTone {
  return {
    'status-running': accent,
    'status-splitting': mix(accent, '#2563eb', 0.46),
    'status-pending': mix(accent, '#d97706', 0.65),
    'status-error': mix(accent, '#dc2626', 0.76),
    'status-reassigning': mix(accent, '#a16207', 0.62),
    'status-completed': mix(accent, '#16a34a', 0.62),
    'status-blocked': mix(accent, '#ca8a04', 0.62),
    'status-paused': mix(accent, '#a16207', 0.48),
    'status-skipped': mix(ink, background, 0.46),
    'status-cancelled': mix(ink, background, 0.56),
  };
}

function buildCoreTokens(
  accent: `#${string}`,
  ink: `#${string}`,
  background: `#${string}`,
  contrastT: number
): ThemeTokens {
  const tokens: ThemeTokens = {};

  // Required core formulas (contract-controlled by contrast)
  const panel = mix(background, ink, 0.02 + contrastT * 0.06);
  const border = alpha(ink, 0.08 + contrastT * 0.16);
  const textSecondary = mix(ink, background, 0.28 - contrastT * 0.08);
  const hover = mix(background, ink, 0.03 + contrastT * 0.05);

  // Extended derived values for consistency across interactive states.
  const active = mix(background, ink, 0.05 + contrastT * 0.08);
  const panelStrong = mix(background, ink, 0.04 + contrastT * 0.08);
  const panelSelected = mix(background, ink, 0.1 + contrastT * 0.1);
  const panelSelectedStrong = mix(background, ink, 0.16 + contrastT * 0.12);
  const mutedDefault = mix(background, ink, 0.06 + contrastT * 0.06);
  const mutedHover = mix(background, ink, 0.08 + contrastT * 0.07);
  const mutedActive = mix(background, ink, 0.1 + contrastT * 0.08);
  const mutedSelected = mix(background, ink, 0.12 + contrastT * 0.09);
  const mutedDisabled = mix(background, ink, 0.08 + contrastT * 0.07);
  const subtleHover = mix(background, ink, 0.04 + contrastT * 0.065);
  const subtleActive = mix(background, ink, 0.05 + contrastT * 0.08);
  const subtleSelected = mix(background, ink, 0.06 + contrastT * 0.08);
  const inverseBgDefault = mix(ink, background, 0.88);
  const inverseBgHover = mix(ink, background, 0.82);
  const inverseBgActive = mix(ink, background, 0.76);
  const inverseBgSelected = mix(ink, background, 0.7);
  const inverseBgDisabled = mix(ink, background, 0.5);
  const textMuted = mix(ink, background, 0.45 - contrastT * 0.12);
  const textDisabled = alpha(ink, 0.38);
  const textDefaultHover = mix(ink, background, 0.9);
  const textDefaultActive = mix(ink, background, 0.82);
  const textDefaultSelected = mix(ink, background, 0.86);
  const textMutedHover = mix(textSecondary, ink, 0.16);
  const textMutedActive = mix(textSecondary, ink, 0.26);
  const textMutedSelected = mix(textSecondary, ink, 0.22);
  const textSubtleHover = mix(textMuted, ink, 0.2);
  const textSubtleActive = mix(textMuted, ink, 0.3);
  const textSubtleSelected = mix(textMuted, ink, 0.26);
  const textStrong = mix(ink, background, 0.95);
  const textInverse = chooseReadableText(inverseBgDefault, ink);

  tokens['bg.neutral.subtle.default'] = background;
  // Hover between canvas and selected (used by nav tabs, outline buttons, etc.)
  tokens['bg.neutral.subtle.hover'] = subtleHover;
  tokens['bg.neutral.subtle.selected'] = subtleSelected;
  tokens['bg.neutral.default.default'] = panel;
  tokens['bg.neutral.default.hover'] = hover;
  tokens['bg.neutral.default.active'] = active;
  tokens['bg.neutral.default.selected'] = panelSelected;
  tokens['bg.neutral.strong.default'] = panelStrong;
  tokens['bg.neutral.strong.selected'] = panelSelectedStrong;
  // Muted surfaces remain solid fills (no alpha overlays).
  tokens['bg.neutral.muted.default'] = mutedDefault;
  tokens['bg.neutral.muted.hover'] = mutedHover;
  tokens['bg.neutral.muted.active'] = mutedActive;
  tokens['bg.neutral.muted.selected'] = mutedSelected;
  tokens['bg.neutral.muted.disabled'] = mutedDisabled;

  tokens['text.neutral.default.default'] = ink;
  tokens['text.neutral.muted.default'] = textSecondary;
  tokens['text.neutral.subtle.default'] = textMuted;
  tokens['text.neutral.muted.disabled'] = textDisabled;

  const accentHover = mix(accent, ink, 0.08 + contrastT * 0.08);
  const accentActive = mix(accent, ink, 0.14 + contrastT * 0.1);
  // Brand buttons should prefer white text when contrast is acceptable for
  // UI button label sizing; fall back to darker text for very light accents.
  const accentForeground = chooseReadableText(accent, '#ffffff', 3);
  tokens['bg.brand.default.default'] = accent;
  tokens['bg.brand.default.hover'] = accentHover;
  tokens['bg.brand.default.active'] = accentActive;
  tokens['text.brand.inverse.default'] = accentForeground;
  tokens['icon.brand.default.default'] = accent;

  tokens['border.neutral.subtle.default'] = alpha(ink, 0.05 + contrastT * 0.1);
  tokens['border.neutral.muted.default'] = alpha(ink, 0.07 + contrastT * 0.12);
  tokens['border.neutral.muted.hover'] = alpha(ink, 0.1 + contrastT * 0.14);
  tokens['border.neutral.muted.disabled'] = alpha(ink, 0.05 + contrastT * 0.08);
  tokens['border.neutral.default.default'] = border;
  tokens['border.neutral.strong.default'] = alpha(ink, 0.14 + contrastT * 0.2);
  tokens['border.brand.default.focus'] = alpha(accent, 0.55 + contrastT * 0.25);

  tokens['ring.neutral.subtle.focus'] = alpha(ink, 0.2 + contrastT * 0.2);
  tokens['ring.brand.default.focus'] = alpha(accent, 0.45 + contrastT * 0.3);

  tokens['icon.neutral.default.default'] = textSecondary;
  tokens['icon.neutral.muted.default'] = textMuted;

  ensureNeutralMatrix(tokens, 'bg', {
    subtle: {
      default: background,
      hover: subtleHover,
      active: subtleActive,
      selected: subtleSelected,
      focus: subtleSelected,
      disabled: mutedDisabled,
    },
    muted: {
      default: mutedDefault,
      hover: mutedHover,
      active: mutedActive,
      selected: mutedSelected,
      focus: mutedHover,
      disabled: mutedDisabled,
    },
    default: {
      default: panel,
      hover,
      active,
      selected: panelSelected,
      focus: active,
      disabled: mutedDisabled,
    },
    strong: {
      default: panelStrong,
      hover: panelSelected,
      active: panelSelectedStrong,
      selected: panelSelectedStrong,
      focus: panelSelected,
      disabled: mutedDisabled,
    },
    inverse: {
      default: inverseBgDefault,
      hover: inverseBgHover,
      active: inverseBgActive,
      selected: inverseBgSelected,
      focus: inverseBgHover,
      disabled: inverseBgDisabled,
    },
  });

  ensureNeutralMatrix(tokens, 'text', {
    subtle: {
      default: textMuted,
      hover: textSubtleHover,
      active: textSubtleActive,
      selected: textSubtleSelected,
      focus: textSubtleHover,
      disabled: textDisabled,
    },
    muted: {
      default: textSecondary,
      hover: textMutedHover,
      active: textMutedActive,
      selected: textMutedSelected,
      focus: textMutedHover,
      disabled: textDisabled,
    },
    default: {
      default: ink,
      hover: textDefaultHover,
      active: textDefaultActive,
      selected: textDefaultSelected,
      focus: textDefaultHover,
      disabled: textDisabled,
    },
    strong: {
      default: textStrong,
      hover: ink,
      active: textDefaultHover,
      selected: ink,
      focus: ink,
      disabled: textDisabled,
    },
    inverse: {
      default: textInverse,
      hover: textInverse,
      active: textInverse,
      selected: textInverse,
      focus: textInverse,
      disabled: alpha(textInverse, 0.5),
    },
  });

  ensureNeutralMatrix(tokens, 'border', {
    subtle: {
      default: alpha(ink, 0.05 + contrastT * 0.1),
      hover: alpha(ink, 0.08 + contrastT * 0.12),
      active: alpha(ink, 0.1 + contrastT * 0.14),
      selected: alpha(ink, 0.11 + contrastT * 0.16),
      focus: alpha(ink, 0.14 + contrastT * 0.2),
      disabled: alpha(ink, 0.04 + contrastT * 0.08),
    },
    muted: {
      default: alpha(ink, 0.07 + contrastT * 0.12),
      hover: alpha(ink, 0.1 + contrastT * 0.14),
      active: alpha(ink, 0.12 + contrastT * 0.16),
      selected: alpha(ink, 0.13 + contrastT * 0.17),
      focus: alpha(ink, 0.15 + contrastT * 0.2),
      disabled: alpha(ink, 0.05 + contrastT * 0.08),
    },
    default: {
      default: border,
      hover: alpha(ink, 0.1 + contrastT * 0.18),
      active: alpha(ink, 0.12 + contrastT * 0.2),
      selected: alpha(ink, 0.11 + contrastT * 0.19),
      focus: alpha(ink, 0.14 + contrastT * 0.22),
      disabled: alpha(ink, 0.05 + contrastT * 0.08),
    },
    strong: {
      default: alpha(ink, 0.14 + contrastT * 0.2),
      hover: alpha(ink, 0.16 + contrastT * 0.22),
      active: alpha(ink, 0.18 + contrastT * 0.24),
      selected: alpha(ink, 0.2 + contrastT * 0.24),
      focus: alpha(ink, 0.22 + contrastT * 0.26),
      disabled: alpha(ink, 0.06 + contrastT * 0.1),
    },
    inverse: {
      default: alpha(textInverse, 0.35),
      hover: alpha(textInverse, 0.45),
      active: alpha(textInverse, 0.55),
      selected: alpha(textInverse, 0.5),
      focus: alpha(textInverse, 0.58),
      disabled: alpha(textInverse, 0.22),
    },
  });

  ensureNeutralMatrix(tokens, 'icon', {
    subtle: {
      default: textMuted,
      hover: textSubtleHover,
      active: textSubtleActive,
      selected: textSubtleSelected,
      focus: textSubtleHover,
      disabled: textDisabled,
    },
    muted: {
      default: textMuted,
      hover: textMutedHover,
      active: textMutedActive,
      selected: textMutedSelected,
      focus: textMutedHover,
      disabled: textDisabled,
    },
    default: {
      default: textSecondary,
      hover: textDefaultHover,
      active: textDefaultActive,
      selected: textDefaultSelected,
      focus: textDefaultHover,
      disabled: textDisabled,
    },
    strong: {
      default: textStrong,
      hover: ink,
      active: textDefaultHover,
      selected: ink,
      focus: ink,
      disabled: textDisabled,
    },
    inverse: {
      default: textInverse,
      hover: textInverse,
      active: textInverse,
      selected: textInverse,
      focus: textInverse,
      disabled: alpha(textInverse, 0.5),
    },
  });

  ensureNeutralMatrix(tokens, 'ring', {
    subtle: {
      default: alpha(ink, 0.1 + contrastT * 0.12),
      hover: alpha(ink, 0.14 + contrastT * 0.14),
      active: alpha(ink, 0.18 + contrastT * 0.18),
      selected: alpha(ink, 0.2 + contrastT * 0.2),
      focus: alpha(ink, 0.2 + contrastT * 0.2),
      disabled: alpha(ink, 0.06 + contrastT * 0.1),
    },
    muted: {
      default: alpha(ink, 0.12 + contrastT * 0.14),
      hover: alpha(ink, 0.16 + contrastT * 0.16),
      active: alpha(ink, 0.2 + contrastT * 0.2),
      selected: alpha(ink, 0.22 + contrastT * 0.22),
      focus: alpha(ink, 0.26 + contrastT * 0.22),
      disabled: alpha(ink, 0.07 + contrastT * 0.1),
    },
    default: {
      default: alpha(ink, 0.14 + contrastT * 0.16),
      hover: alpha(ink, 0.18 + contrastT * 0.2),
      active: alpha(ink, 0.22 + contrastT * 0.22),
      selected: alpha(ink, 0.24 + contrastT * 0.24),
      focus: alpha(ink, 0.28 + contrastT * 0.24),
      disabled: alpha(ink, 0.08 + contrastT * 0.1),
    },
    strong: {
      default: alpha(ink, 0.18 + contrastT * 0.2),
      hover: alpha(ink, 0.22 + contrastT * 0.24),
      active: alpha(ink, 0.26 + contrastT * 0.26),
      selected: alpha(ink, 0.28 + contrastT * 0.28),
      focus: alpha(ink, 0.32 + contrastT * 0.28),
      disabled: alpha(ink, 0.1 + contrastT * 0.12),
    },
    inverse: {
      default: alpha(textInverse, 0.3),
      hover: alpha(textInverse, 0.36),
      active: alpha(textInverse, 0.42),
      selected: alpha(textInverse, 0.44),
      focus: alpha(textInverse, 0.5),
      disabled: alpha(textInverse, 0.2),
    },
  });

  return tokens;
}

function buildStatusTokens(
  accent: `#${string}`,
  ink: `#${string}`,
  background: `#${string}`,
  contrastT: number
): ThemeTokens {
  const tokens: ThemeTokens = {};
  const statusBase = resolveStatusToneBase(accent, ink, background);

  for (const tone of STATUS_TONES) {
    const base = statusBase[tone];
    const bgSubtleDefault = mix(background, base, 0.1 + contrastT * 0.1);
    const bgSubtleHover = mix(background, base, 0.14 + contrastT * 0.12);
    const bgDefault = mix(background, base, 0.2 + contrastT * 0.14);

    tokens[`bg.${tone}.subtle.default`] = bgSubtleDefault;
    tokens[`bg.${tone}.subtle.hover`] = bgSubtleHover;
    tokens[`bg.${tone}.default.default`] = bgDefault;

    tokens[`border.${tone}.default.default`] = alpha(
      base,
      0.32 + contrastT * 0.28
    );
    tokens[`border.${tone}.default.focus`] = alpha(
      base,
      0.45 + contrastT * 0.3
    );
    tokens[`ring.${tone}.default.focus`] = alpha(base, 0.4 + contrastT * 0.35);

    tokens[`icon.${tone}.default.default`] = base;
    tokens[`text.${tone}.strong.default`] = chooseReadableText(
      bgSubtleDefault,
      mix(base, ink, 0.2)
    );
    tokens[`text.${tone}.muted.default`] = mix(base, ink, 0.35);
  }

  return tokens;
}

function buildFixedToneTokens(
  mode: Mode,
  background: `#${string}`,
  ink: `#${string}`,
  contrastT: number,
  schema: FixedToneSchema = DEFAULT_FIXED_TONE_SCHEMA
): ThemeTokens {
  const tokens: ThemeTokens = {};
  const fixed = schema[mode];

  for (const [tone, values] of Object.entries(fixed) as Array<
    [FixedTone, FixedToneSeed]
  >) {
    const base = values.color;
    const bgSubtleDefault = mix(background, base, 0.1 + contrastT * 0.1);
    const bgSubtleHover = mix(background, base, 0.14 + contrastT * 0.12);
    const bgSubtleActive = mix(background, base, 0.18 + contrastT * 0.14);
    const bgDefault = mix(background, base, 0.2 + contrastT * 0.14);
    const textHover = mix(base, ink, 0.12 + contrastT * 0.06);
    const textActive = mix(base, ink, 0.2 + contrastT * 0.08);
    const borderDefault = alpha(base, 0.32 + contrastT * 0.28);
    const borderHover = alpha(base, 0.38 + contrastT * 0.3);
    const borderFocus = alpha(base, 0.45 + contrastT * 0.3);

    // Text: full emphasis ramp (UI state `default`). Regular semantic color is
    // `text.<tone>.default.default` (e.g. `text.error.default.default`).
    tokens[`text.${tone}.subtle.default`] = mix(
      base,
      background,
      0.48 + contrastT * 0.1
    );
    tokens[`text.${tone}.muted.default`] = mix(
      base,
      ink,
      0.18 + contrastT * 0.06
    );
    tokens[`text.${tone}.default.default`] = base;
    tokens[`text.${tone}.default.hover`] = textHover;
    tokens[`text.${tone}.default.active`] = textActive;
    tokens[`text.${tone}.strong.default`] = mix(
      base,
      ink,
      0.4 + contrastT * 0.12
    );
    tokens[`text.${tone}.inverse.default`] = chooseReadableText(bgDefault, ink);

    tokens[`icon.${tone}.default.default`] = base;
    tokens[`icon.${tone}.default.hover`] = textHover;
    tokens[`icon.${tone}.default.active`] = textActive;

    tokens[`border.${tone}.default.default`] = borderDefault;
    tokens[`border.${tone}.default.hover`] = borderHover;
    tokens[`border.${tone}.default.focus`] = borderFocus;
    tokens[`ring.${tone}.default.focus`] = alpha(base, 0.4 + contrastT * 0.35);

    tokens[`bg.${tone}.subtle.default`] = bgSubtleDefault;
    tokens[`bg.${tone}.subtle.hover`] = bgSubtleHover;
    tokens[`bg.${tone}.subtle.active`] = bgSubtleActive;
    tokens[`bg.${tone}.subtle.selected`] =
      values.selectedBg ?? mix(background, base, 0.16 + contrastT * 0.12);
    tokens[`bg.${tone}.default.default`] = bgDefault;
  }

  return tokens;
}

function toCssVariables(tokens: ThemeTokens): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [tokenKey, value] of Object.entries(tokens)) {
    if (!value) continue;
    variables[tokenKeyToCssVarName(tokenKey as TokenKey)] = value;
  }
  return variables;
}

function resolveContract(contract: ThemeContractV1): ThemeContractV1 {
  return {
    ...contract,
    contrast: clamp(Math.round(contract.contrast), 0, 100),
  };
}

function getThemeSeed(
  contract: ThemeContractV1,
  catalog: ThemeCatalog
): {
  colorThemeId: string;
  seed: ResolvedThemeV1['seed'];
} {
  const definition = getColorThemeDefinition(
    contract.mode,
    contract.colorThemeId,
    catalog
  );
  return {
    colorThemeId: definition.id,
    seed: definition.seed,
  };
}

export function buildThemeV1(
  contract: ThemeContractV1,
  catalog: ThemeCatalog = DEFAULT_THEME_CATALOG
): ResolvedThemeV1 {
  const resolvedContract = resolveContract(contract);
  const { colorThemeId, seed } = getThemeSeed(resolvedContract, catalog);
  const contrastT = resolvedContract.contrast / 100;

  const core = buildCoreTokens(
    seed.accent,
    seed.ink,
    seed.background,
    contrastT
  );
  const status = buildStatusTokens(
    seed.accent,
    seed.ink,
    seed.background,
    contrastT
  );
  const fixedTone = buildFixedToneTokens(
    resolvedContract.mode,
    seed.background,
    seed.ink,
    contrastT
  );
  const tokens: ThemeTokens = {
    ...core,
    ...status,
    ...fixedTone,
  };

  return {
    contract: {
      ...resolvedContract,
      colorThemeId,
    },
    seed,
    tokens,
    cssVariables: toCssVariables(tokens),
  };
}

export function applyResolvedThemeToElement(
  resolvedTheme: ResolvedThemeV1,
  element: HTMLElement
): void {
  for (const [name, value] of Object.entries(resolvedTheme.cssVariables)) {
    element.style.setProperty(name, value);
  }
}

export function applyThemeContractV1(
  contract: ThemeContractV1,
  element: HTMLElement,
  catalog: ThemeCatalog = DEFAULT_THEME_CATALOG
): ResolvedThemeV1 {
  const resolved = buildThemeV1(contract, catalog);
  applyResolvedThemeToElement(resolved, element);
  return resolved;
}
