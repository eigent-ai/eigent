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

import baseColorTokens from '../../style/tokens/base.color.json';
import componentTokens from '../../style/tokens/component.color.json';
import semanticTokens from '../../style/tokens/semantic.color.json';
import { DEFAULT_THEME_CATALOG, getColorThemeDefinitionV2 } from './catalog';
import {
  alpha,
  apcaContrastApprox,
  chooseReadableText,
  clamp,
  contrastRatio,
  hexToOklch,
  mix,
  normalizeHue,
  oklchToHex,
  rgbToHex,
  wcagMinimumContrast,
  type Oklch,
} from './colorMath';
import {
  flattenDtcgTokens,
  resolveAliasReferences,
  resolveExtends,
} from './dtcg';
import { tokenKeyToCssVarName } from './naming';
import type {
  Adjustment,
  ContrastDiagnostic,
  Element,
  Emphasis,
  Mode,
  ResolvedThemeV2,
  State,
  ThemeCatalogV2,
  ThemeContractV2,
  ThemeTokens,
  TokenKey,
  Tone,
} from './types';

type SemanticShape = {
  axes: {
    elements: Element[];
    tones: Tone[];
    emphasis: Emphasis[];
    states: State[];
  };
  transforms: {
    emphasis: Record<Emphasis, Adjustment>;
    state: Record<State, Adjustment>;
    element: Record<Element, Adjustment>;
  };
  toneSource: Record<
    Tone,
    {
      source: 'accent' | 'background' | 'ink' | 'fixed';
      sourceByElement?: Partial<
        Record<Element, 'accent' | 'background' | 'ink' | 'fixed'>
      >;
      dL?: number;
      dC?: number;
      dH?: number;
      dLLight?: number;
      dLDark?: number;
    }
  >;
  contrastPairs: Array<{
    fg: TokenKey;
    bg: TokenKey;
    minContrast: number;
    largeText?: boolean;
  }>;
};

type BaseShape = {
  fixedAnchors: Record<Mode, Partial<Record<Tone, `#${string}`>>>;
  fixedShadeScales?: Partial<
    Record<
      Tone,
      Partial<
        Record<
          | '50'
          | '100'
          | '200'
          | '300'
          | '400'
          | '500'
          | '600'
          | '700'
          | '800'
          | '900'
          | '950',
          `#${string}`
        >
      >
    >
  >;
};

const BASE = baseColorTokens as BaseShape;
const SEMANTIC = semanticTokens as SemanticShape;
const LEGACY_NEUTRAL_EMPHASIS: Emphasis[] = [
  'subtle',
  'muted',
  'default',
  'strong',
  'inverse',
];
const LEGACY_UI_STATES: State[] = [
  'default',
  'hover',
  'active',
  'selected',
  'focus',
  'disabled',
];

type NeutralStateMatrix = Record<Emphasis, Record<State, string>>;

const SYSTEM_STATUS_TONES = new Set<Tone>([
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
  'success',
  'error',
  'warning',
  'information',
]);

type FixedShade =
  | '50'
  | '100'
  | '200'
  | '300'
  | '400'
  | '500'
  | '600'
  | '700'
  | '800'
  | '900'
  | '950';

const SYSTEM_STATUS_SHADE_BY_EMPHASIS: Record<
  Extract<Emphasis, 'subtle' | 'muted' | 'default' | 'strong'>,
  Record<State, FixedShade>
> = {
  subtle: {
    default: '50',
    hover: '100',
    active: '200',
    selected: '200',
    focus: '100',
    disabled: '50',
  },
  muted: {
    default: '300',
    hover: '400',
    active: '500',
    selected: '500',
    focus: '400',
    disabled: '300',
  },
  default: {
    default: '600',
    hover: '700',
    active: '800',
    selected: '800',
    focus: '700',
    disabled: '600',
  },
  strong: {
    default: '900',
    hover: '950',
    active: '950',
    selected: '950',
    focus: '950',
    disabled: '900',
  },
};

// Per-state opacity used for the `transparent` emphasis. The surface color is
// the tone's base hue shown at these alphas so status chips read as "main
// color, faded" rather than a washed-out rendered hue.
const TRANSPARENT_OPACITY_BY_STATE: Record<State, number> = {
  default: 0.1,
  hover: 0.3,
  active: 0.5,
  selected: 0.7,
  focus: 0.3,
  disabled: 0.5,
};

const SYSTEM_STATUS_TRANSPARENT_OPACITY_BY_STATE: Record<State, number> = {
  default: 0.3,
  hover: 0.5,
  active: 0.5,
  selected: 0.7,
  focus: 0.5,
  disabled: 0.1,
};

function mergeAdjustment(...values: Array<Adjustment | undefined>): Adjustment {
  const out: Adjustment = {};
  for (const value of values) {
    if (!value) continue;
    if (typeof value.dL === 'number') out.dL = (out.dL ?? 0) + value.dL;
    if (typeof value.dC === 'number') out.dC = (out.dC ?? 0) + value.dC;
    if (typeof value.dH === 'number') out.dH = (out.dH ?? 0) + value.dH;
    if (typeof value.alpha === 'number') out.alpha = value.alpha;
  }
  return out;
}

function applyAdjustment(base: Oklch, adjustment: Adjustment): Oklch {
  return {
    l: clamp(base.l + (adjustment.dL ?? 0), 0, 1),
    c: Math.max(0, base.c + (adjustment.dC ?? 0)),
    h: normalizeHue(base.h + (adjustment.dH ?? 0)),
  };
}

function setTokenIfMissing(
  tokens: ThemeTokens,
  tokenKey: TokenKey,
  value: string
): void {
  if (!(tokenKey in tokens)) {
    tokens[tokenKey] = value;
  }
}

function getFixedShade(tone: Tone, shade: FixedShade): `#${string}` | null {
  return BASE.fixedShadeScales?.[tone]?.[shade] ?? null;
}

function getSystemStatusShade(
  tone: Tone,
  emphasis: Extract<Emphasis, 'subtle' | 'muted' | 'default' | 'strong'>,
  state: State
): `#${string}` | null {
  const shade = SYSTEM_STATUS_SHADE_BY_EMPHASIS[emphasis][state];
  return getFixedShade(tone, shade);
}

function ensureNeutralMatrix(
  tokens: ThemeTokens,
  element: Element,
  matrix: NeutralStateMatrix
): void {
  for (const emphasis of LEGACY_NEUTRAL_EMPHASIS) {
    for (const state of LEGACY_UI_STATES) {
      setTokenIfMissing(
        tokens,
        `${element}.neutral.${emphasis}.${state}` as TokenKey,
        matrix[emphasis][state]
      );
    }
  }
}

function buildLegacyNeutralContrastTokens(
  seed: { accent: `#${string}`; background: `#${string}`; ink: `#${string}` },
  contrast: number
): ThemeTokens {
  const tokens: ThemeTokens = {};
  const contrastT = clamp(contrast, 0, 100) / 100;
  const { background, ink } = seed;

  const panel = mix(background, ink, 0.02 + contrastT * 0.06);
  const border = alpha(ink, 0.08 + contrastT * 0.16);
  const textSecondary = mix(ink, background, 0.28 - contrastT * 0.08);
  const hover = mix(background, ink, 0.03 + contrastT * 0.05);
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
  tokens['bg.neutral.subtle.hover'] = subtleHover;
  tokens['bg.neutral.subtle.selected'] = subtleSelected;
  tokens['bg.neutral.default.default'] = panel;
  tokens['bg.neutral.default.hover'] = hover;
  tokens['bg.neutral.default.active'] = active;
  tokens['bg.neutral.default.selected'] = panelSelected;
  tokens['bg.neutral.strong.default'] = panelStrong;
  tokens['bg.neutral.strong.selected'] = panelSelectedStrong;
  tokens['bg.neutral.muted.default'] = mutedDefault;
  tokens['bg.neutral.muted.hover'] = mutedHover;
  tokens['bg.neutral.muted.active'] = mutedActive;
  tokens['bg.neutral.muted.selected'] = mutedSelected;
  tokens['bg.neutral.muted.disabled'] = mutedDisabled;

  tokens['text.neutral.default.default'] = ink;
  tokens['text.neutral.muted.default'] = textSecondary;
  tokens['text.neutral.subtle.default'] = textMuted;
  tokens['text.neutral.muted.disabled'] = textDisabled;

  tokens['border.neutral.subtle.default'] = alpha(ink, 0.05 + contrastT * 0.1);
  tokens['border.neutral.muted.default'] = alpha(ink, 0.07 + contrastT * 0.12);
  tokens['border.neutral.muted.hover'] = alpha(ink, 0.1 + contrastT * 0.14);
  tokens['border.neutral.muted.disabled'] = alpha(ink, 0.05 + contrastT * 0.08);
  tokens['border.neutral.default.default'] = border;
  tokens['border.neutral.strong.default'] = alpha(ink, 0.14 + contrastT * 0.2);
  tokens['ring.neutral.subtle.focus'] = alpha(ink, 0.2 + contrastT * 0.2);
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

function parseCssColor(
  color: string | undefined
): { oklch: Oklch; alpha?: number } | null {
  const hex = parseHexOnly(color);
  if (hex) return { oklch: hexToOklch(hex) };

  if (!color) return null;
  const rgbaMatch = color
    .trim()
    .match(
      /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|0?\.\d+|1(?:\.0+)?)\s*\)$/i
    );
  if (!rgbaMatch) return null;

  const r = clamp(Number(rgbaMatch[1]), 0, 255);
  const g = clamp(Number(rgbaMatch[2]), 0, 255);
  const b = clamp(Number(rgbaMatch[3]), 0, 255);
  const a = clamp(Number(rgbaMatch[4]), 0, 1);
  const parsedHex = rgbToHex(r, g, b);
  return { oklch: hexToOklch(parsedHex), alpha: a };
}

function contrastBias(
  element: Element,
  mode: Mode,
  contrast: number
): Adjustment {
  const t = clamp(contrast, 0, 100) / 100;
  const direction = mode === 'dark' ? 1 : -1;
  if (element === 'bg') {
    return { dL: direction * (0.01 + t * 0.07) };
  }
  if (element === 'text' || element === 'icon') {
    return { dL: direction * (0.02 + t * 0.08) };
  }
  if (element === 'border' || element === 'ring') {
    return { dL: direction * (0.01 + t * 0.05) };
  }
  return {};
}

function toneBaseColor(
  tone: Tone,
  mode: Mode,
  seed: { accent: `#${string}`; background: `#${string}`; ink: `#${string}` },
  element: Element
): Oklch {
  const spec = SEMANTIC.toneSource[tone];
  const source = spec.sourceByElement?.[element] ?? spec.source;
  const sourceHex =
    source === 'fixed'
      ? (BASE.fixedAnchors[mode][tone] ?? seed.accent)
      : seed[source as 'accent' | 'background' | 'ink'];
  const base = hexToOklch(sourceHex);
  return applyAdjustment(base, {
    dL:
      (spec.dL ?? 0) +
      (mode === 'light' ? (spec.dLLight ?? 0) : (spec.dLDark ?? 0)),
    dC: spec.dC ?? 0,
    dH: spec.dH ?? 0,
  });
}

function parseHexOnly(color: string | undefined): `#${string}` | null {
  if (!color) return null;
  const trimmed = color.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(trimmed)) return null;
  return trimmed as `#${string}`;
}

function solveForegroundContrast(
  fgHex: `#${string}`,
  bgHex: `#${string}`,
  minContrast: number
): `#${string}` {
  const current = contrastRatio(fgHex, bgHex);
  if (current >= minContrast) return fgHex;

  const base = hexToOklch(fgHex);
  let best: { hex: `#${string}`; delta: number } | null = null;
  for (let i = 0; i <= 100; i += 1) {
    const targetL = i / 100;
    const probeHex = oklchToHex({ l: targetL, c: base.c, h: base.h });
    const ratio = contrastRatio(probeHex, bgHex);
    if (ratio >= minContrast) {
      const delta = Math.abs(targetL - base.l);
      if (!best || delta < best.delta) best = { hex: probeHex, delta };
    }
  }
  if (best) return best.hex;

  // Chroma reduction pass if pure lightness search was insufficient.
  for (let i = 0; i <= 100; i += 1) {
    const targetC = (base.c * (100 - i)) / 100;
    const probeHex = oklchToHex({ l: base.l, c: targetC, h: base.h });
    if (contrastRatio(probeHex, bgHex) >= minContrast) return probeHex;
  }

  return chooseReadableText(bgHex, fgHex, minContrast);
}

function enforceContrastPairs(tokens: ThemeTokens): {
  tokens: ThemeTokens;
  diagnostics: ContrastDiagnostic[];
} {
  const out: ThemeTokens = { ...tokens };
  const diagnostics: ContrastDiagnostic[] = [];
  for (const pair of SEMANTIC.contrastPairs) {
    const fgToken = pair.fg;
    const bgToken = pair.bg;
    const fgValue = out[fgToken];
    const bgValue = out[bgToken];
    const fgHex = parseHexOnly(fgValue);
    const bgHex = parseHexOnly(bgValue);
    if (!fgHex || !bgHex) continue;

    const minRequired = Math.max(
      pair.minContrast ?? 0,
      wcagMinimumContrast(pair.largeText)
    );
    const solvedFg = solveForegroundContrast(fgHex, bgHex, minRequired);
    out[fgToken] = solvedFg;

    const ratio = contrastRatio(solvedFg, bgHex);
    diagnostics.push({
      fg: fgToken,
      bg: bgToken,
      ratio,
      minRequired,
      passes: ratio >= minRequired,
      apcaLc: apcaContrastApprox(solvedFg, bgHex),
    });
  }
  return { tokens: out, diagnostics };
}

function buildSemanticTokens(
  contract: ThemeContractV2,
  seed: ResolvedThemeV2['seed']
) {
  const tokens: ThemeTokens = {};
  const { elements, tones, emphasis, states } = SEMANTIC.axes;
  const legacyNeutralTokens = buildLegacyNeutralContrastTokens(
    seed,
    contract.contrast
  );

  for (const tone of tones) {
    for (const emph of emphasis) {
      for (const state of states) {
        const tokenSuffix = `${tone}.${emph}.${state}` as const;
        const baseAdjustment = mergeAdjustment(
          SEMANTIC.transforms.emphasis[emph],
          SEMANTIC.transforms.state[state]
        );
        const axisOverride = mergeAdjustment(
          contract.overrides?.tone?.[tone],
          contract.overrides?.emphasis?.[emph],
          contract.overrides?.state?.[state],
          contract.overrides?.cell?.[tokenSuffix]
        );

        for (const element of elements) {
          const tokenKey = `${element}.${tokenSuffix}` as TokenKey;
          const alphaOnlyAdjustment = mergeAdjustment(
            baseAdjustment,
            SEMANTIC.transforms.element[element],
            axisOverride
          );

          if (SYSTEM_STATUS_TONES.has(tone) && emph !== 'inverse') {
            if (emph === 'transparent') {
              const baseHex =
                getFixedShade(tone, '600') ??
                oklchToHex(toneBaseColor(tone, contract.mode, seed, element));
              const stateAlpha =
                SYSTEM_STATUS_TRANSPARENT_OPACITY_BY_STATE[state as State] ??
                0.3;
              const resolvedAlpha =
                typeof axisOverride.alpha === 'number'
                  ? axisOverride.alpha
                  : stateAlpha;
              tokens[tokenKey] = alpha(baseHex, resolvedAlpha);
              continue;
            }

            const statusShade = getSystemStatusShade(
              tone,
              emph as Extract<
                Emphasis,
                'subtle' | 'muted' | 'default' | 'strong'
              >,
              state
            );
            if (statusShade) {
              tokens[tokenKey] =
                typeof alphaOnlyAdjustment.alpha === 'number' &&
                alphaOnlyAdjustment.alpha < 1
                  ? alpha(statusShade, alphaOnlyAdjustment.alpha)
                  : statusShade;
              continue;
            }
          }

          if (emph === 'transparent') {
            const toneBase = toneBaseColor(tone, contract.mode, seed, element);
            const baseHex = oklchToHex(toneBase);
            const stateAlpha =
              TRANSPARENT_OPACITY_BY_STATE[state as State] ?? 0.1;
            const resolvedAlpha =
              typeof axisOverride.alpha === 'number'
                ? axisOverride.alpha
                : stateAlpha;
            tokens[tokenKey] = alpha(baseHex, resolvedAlpha);
            continue;
          }

          if (tone === 'neutral') {
            const legacy = parseCssColor(legacyNeutralTokens[tokenKey]);
            if (legacy) {
              const adjusted = applyAdjustment(legacy.oklch, axisOverride);
              const legacyHex = oklchToHex(adjusted);
              const resolvedAlpha =
                typeof axisOverride.alpha === 'number'
                  ? axisOverride.alpha
                  : legacy.alpha;
              tokens[tokenKey] =
                typeof resolvedAlpha === 'number' && resolvedAlpha < 1
                  ? alpha(legacyHex, resolvedAlpha)
                  : legacyHex;
              continue;
            }
          }

          const toneBase = toneBaseColor(tone, contract.mode, seed, element);
          const adjustment = mergeAdjustment(
            alphaOnlyAdjustment,
            contrastBias(element, contract.mode, contract.contrast)
          );

          const colorHex = oklchToHex(applyAdjustment(toneBase, adjustment));
          const value =
            typeof adjustment.alpha === 'number' && adjustment.alpha < 1
              ? alpha(colorHex, adjustment.alpha)
              : colorHex;
          tokens[tokenKey] = value;
        }
      }
    }
  }
  return tokens;
}

/**
 * Tones used for filled primary-style controls (`button` `TONE_PRIMARY`): same rule as
 * brand — prefer near-white on saturated fills (WCAG large-text ~3:1), else best black/white.
 */
const FILLED_ACCENT_INVERSE_TONES: Tone[] = [
  'brand',
  'success',
  'error',
  'warning',
  'information',
];

function applyFilledAccentInverseTextHeuristic(
  tokens: ThemeTokens
): ThemeTokens {
  const out: ThemeTokens = { ...tokens };
  for (const tone of FILLED_ACCENT_INVERSE_TONES) {
    for (const state of SEMANTIC.axes.states) {
      const bgKey = `bg.${tone}.default.${state}` as TokenKey;
      const textKey = `text.${tone}.inverse.${state}` as TokenKey;
      const bgHex = parseHexOnly(out[bgKey]);
      if (!bgHex) continue;
      out[textKey] = chooseReadableText(bgHex, '#ffffff', 3);
    }
  }
  return out;
}

function buildComponentAliasVariables(
  tokens: ThemeTokens
): Record<string, string> {
  const resolved = resolveExtends(componentTokens as Record<string, unknown>);
  const leaves = flattenDtcgTokens(resolved);
  const out: Record<string, string> = {};
  for (const leaf of leaves) {
    if (typeof leaf.value !== 'string') continue;
    const resolvedValue = resolveAliasReferences(leaf.value, (path) => {
      const key = path as TokenKey;
      return tokens[key];
    });
    const cssVar = (leaf.extensions?.cssVar as string | undefined) ?? null;
    if (!cssVar || !resolvedValue) continue;
    out[cssVar] = resolvedValue;
  }
  return out;
}

function toCssVariables(tokens: ThemeTokens): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [tokenKey, value] of Object.entries(tokens)) {
    if (!value) continue;
    variables[tokenKeyToCssVarName(tokenKey as TokenKey)] = value;
  }
  return variables;
}

function normalizeContract(contract: ThemeContractV2): ThemeContractV2 {
  return {
    ...contract,
    contrast: clamp(Math.round(contract.contrast), 0, 100),
  };
}

function getThemeSeed(contract: ThemeContractV2, catalog: ThemeCatalogV2) {
  const definition = getColorThemeDefinitionV2(
    contract.mode,
    contract.themeId,
    catalog
  );
  return {
    themeId: definition.id,
    seed: definition.seed,
  };
}

function computeThemeV2(
  contract: ThemeContractV2,
  catalog: ThemeCatalogV2
): ResolvedThemeV2 {
  const normalized = normalizeContract(contract);
  const { seed, themeId } = getThemeSeed(normalized, catalog);

  const semantic = buildSemanticTokens(normalized, seed);
  const accentInverseAdjusted = applyFilledAccentInverseTextHeuristic(semantic);
  const enforced = enforceContrastPairs(accentInverseAdjusted);
  const semanticCssVars = toCssVariables(enforced.tokens);
  const componentVars = buildComponentAliasVariables(enforced.tokens);
  const cssVariables = {
    ...semanticCssVars,
    ...componentVars,
    '--ds-theme-contrast': String(normalized.contrast),
  };

  return {
    contract: {
      ...normalized,
      themeId,
    },
    seed,
    tokens: enforced.tokens,
    cssVariables,
    diagnostics: {
      contrast: enforced.diagnostics,
    },
  };
}

// Memoize by catalog identity so swapping in a user catalog invalidates the
// right entries without keeping dead catalogs alive. Per-catalog LRU keeps the
// footprint bounded for the live-contrast slider case.
const BUILD_THEME_CACHE = new WeakMap<
  ThemeCatalogV2,
  Map<string, ResolvedThemeV2>
>();
const MAX_CACHE_ENTRIES_PER_CATALOG = 32;

function contractCacheKey(contract: ThemeContractV2): string {
  const normalized = normalizeContract(contract);
  return `${normalized.mode}|${normalized.themeId}|${normalized.contrast}|${
    normalized.overrides ? JSON.stringify(normalized.overrides) : '-'
  }`;
}

export function buildThemeV2(
  contract: ThemeContractV2,
  catalog: ThemeCatalogV2 = DEFAULT_THEME_CATALOG
): ResolvedThemeV2 {
  const key = contractCacheKey(contract);
  let perCatalog = BUILD_THEME_CACHE.get(catalog);
  if (perCatalog) {
    const cached = perCatalog.get(key);
    if (cached) {
      perCatalog.delete(key);
      perCatalog.set(key, cached);
      return cached;
    }
  } else {
    perCatalog = new Map();
    BUILD_THEME_CACHE.set(catalog, perCatalog);
  }

  const result = computeThemeV2(contract, catalog);
  if (perCatalog.size >= MAX_CACHE_ENTRIES_PER_CATALOG) {
    const oldestKey = perCatalog.keys().next().value;
    if (oldestKey !== undefined) perCatalog.delete(oldestKey);
  }
  perCatalog.set(key, result);
  return result;
}

export function applyResolvedThemeToElement(
  resolvedTheme: ResolvedThemeV2,
  element: HTMLElement
): void {
  for (const [name, value] of Object.entries(resolvedTheme.cssVariables)) {
    element.style.setProperty(name, value);
  }
}

export function applyThemeContractV2(
  contract: ThemeContractV2,
  element: HTMLElement,
  catalog: ThemeCatalogV2 = DEFAULT_THEME_CATALOG
): ResolvedThemeV2 {
  const resolved = buildThemeV2(contract, catalog);
  applyResolvedThemeToElement(resolved, element);
  return resolved;
}

export function createApcaDiagnosticsReport(
  resolvedTheme: ResolvedThemeV2
): string {
  return JSON.stringify(
    {
      contract: resolvedTheme.contract,
      diagnostics: resolvedTheme.diagnostics,
    },
    null,
    2
  );
}
