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
  const textMuted = mix(ink, background, 0.45 - contrastT * 0.12);

  tokens['bg.neutral.subtle.default'] = background;
  tokens['bg.neutral.subtle.selected'] = mix(
    background,
    ink,
    0.06 + contrastT * 0.08
  );
  tokens['bg.neutral.default.default'] = panel;
  tokens['bg.neutral.default.hover'] = hover;
  tokens['bg.neutral.default.active'] = active;
  tokens['bg.neutral.default.selected'] = panelSelected;
  tokens['bg.neutral.strong.default'] = panelStrong;
  tokens['bg.neutral.strong.selected'] = panelSelectedStrong;
  // Disabled surfaces remain solid fills (no alpha overlays).
  tokens['bg.neutral.muted.disabled'] = mix(
    background,
    ink,
    0.08 + contrastT * 0.07
  );

  tokens['text.neutral.default.default'] = ink;
  tokens['text.neutral.muted.default'] = textSecondary;
  tokens['text.neutral.subtle.default'] = textMuted;
  tokens['text.neutral.muted.disabled'] = alpha(ink, 0.38);

  const accentHover = mix(accent, ink, 0.08 + contrastT * 0.08);
  const accentActive = mix(accent, ink, 0.14 + contrastT * 0.1);
  const accentForeground = chooseReadableText(accent, ink);
  tokens['bg.brand.default.default'] = accent;
  tokens['bg.brand.default.hover'] = accentHover;
  tokens['bg.brand.default.active'] = accentActive;
  tokens['text.brand.inverse.default'] = accentForeground;
  tokens['icon.brand.default.default'] = accent;

  tokens['border.neutral.subtle.default'] = alpha(ink, 0.05 + contrastT * 0.1);
  tokens['border.neutral.default.default'] = border;
  tokens['border.neutral.strong.default'] = alpha(ink, 0.14 + contrastT * 0.2);
  tokens['border.brand.default.focus'] = alpha(accent, 0.55 + contrastT * 0.25);

  tokens['ring.neutral.subtle.focus'] = alpha(ink, 0.2 + contrastT * 0.2);
  tokens['ring.brand.default.focus'] = alpha(accent, 0.45 + contrastT * 0.3);

  tokens['icon.neutral.default.default'] = textSecondary;
  tokens['icon.neutral.muted.default'] = textMuted;

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

    tokens[`text.${tone}.default.default`] = base;
    tokens[`text.${tone}.default.hover`] = textHover;
    tokens[`text.${tone}.default.active`] = textActive;

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
