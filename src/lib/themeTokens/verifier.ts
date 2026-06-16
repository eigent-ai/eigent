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

// V2 design-token engine verifier.
//
// The engine declares a short list of `contrastPairs` in semantic.color.json and
// actively solves the foreground color to meet each pair's threshold. This
// verifier:
//   1. Exercises every (mode x theme x contrast-grid) variant.
//   2. Forwards the engine's own declared-pair diagnostics.
//   3. Checks **additional, undeclared** pairings that the engine does NOT solve
//      for — every status badge and every fixed tone's `strong` text on its
//      `subtle` surface. Those are what typically drift as transforms are tuned,
//      because the engine won't auto-correct them.
//   4. Validates token coverage and CSS-value syntax.
//
// Structured output lets both the CLI script and vitest consume the same result.

import {
  DEFAULT_THEME_CATALOG,
  createDefaultThemeContractV2,
  getColorThemeDefinitionV2,
} from './catalog';
import { contrastRatio } from './colorMath';
import { buildThemeV2 } from './engine';
import {
  TOKEN_ELEMENTS,
  TOKEN_EMPHASIS,
  TOKEN_TONES,
  TOKEN_UI_STATES,
  type Mode,
  type ResolvedThemeV2,
  type ThemeCatalogV2,
  type TokenKey,
} from './types';

export type VerifySeverity = 'error' | 'warn';

export type VerifyFinding = {
  severity: VerifySeverity;
  mode: Mode;
  themeId: string;
  contrast: number;
  code: string;
  message: string;
  tokenKey?: string;
  value?: string;
  ratio?: number;
  threshold?: number;
};

export type VerifySummary = {
  variantsChecked: number;
  errors: number;
  warnings: number;
};

export type VerifyReport = {
  summary: VerifySummary;
  findings: VerifyFinding[];
};

// WCAG 2.1 AA minimums. "Large text" applies to >=18pt or bold >=14pt.
const MIN_CONTRAST_NORMAL_AA = 4.5;
const MIN_CONTRAST_LARGE_AA = 3.0;

// Contrast grid covers the engine's full input range. 43 is the app default.
const DEFAULT_CONTRAST_GRID = [0, 25, 43, 75, 100];

// Tokens the engine is required to emit for every variant. Missing any of these
// is an error, not a warning, since downstream components hard-reference them.
const REQUIRED_CORE_TOKENS: TokenKey[] = [
  'bg.neutral.subtle.default',
  'bg.neutral.default.default',
  'bg.neutral.muted.default',
  'bg.neutral.strong.default',
  'bg.brand.default.default',
  'text.neutral.default.default',
  'text.neutral.muted.default',
  'text.neutral.subtle.default',
  'text.brand.inverse.default',
  'border.neutral.default.default',
  'border.neutral.strong.default',
  'ring.brand.default.focus',
  'icon.neutral.default.default',
];

type Pairing = {
  bg: TokenKey;
  text: TokenKey;
  threshold: number;
  label: string;
};

// Status + fixed-tone badges typically render `text.<tone>.strong.default` on
// `bg.<tone>.subtle.default`. None of these are in semantic.color.json's
// `contrastPairs` so the engine doesn't auto-solve them — perfect place for the
// verifier to catch regressions.
const AUXILIARY_BADGE_TONES: Array<{
  tone: string;
  threshold: number;
  label?: string;
}> = [
  // Task lifecycle (10 tones)
  { tone: 'status-running', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'status-splitting', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'status-pending', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'status-error', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'status-reassigning', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'status-completed', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'status-blocked', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'status-paused', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'status-skipped', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'status-cancelled', threshold: MIN_CONTRAST_NORMAL_AA },
  // Fixed tones (10)
  { tone: 'single-agent', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'workforce', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'browser', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'terminal', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'document', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'success', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'caution', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'error', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'warning', threshold: MIN_CONTRAST_NORMAL_AA },
  { tone: 'information', threshold: MIN_CONTRAST_NORMAL_AA },
];

function buildAuxiliaryPairings(): Pairing[] {
  const pairs: Pairing[] = [];
  for (const { tone, threshold, label } of AUXILIARY_BADGE_TONES) {
    pairs.push({
      bg: `bg.${tone}.subtle.default` as TokenKey,
      text: `text.${tone}.strong.default` as TokenKey,
      threshold,
      label: label ?? `${tone} badge text on subtle surface`,
    });
  }
  // Body text on muted surface — not declared but ubiquitous.
  pairs.push({
    bg: 'bg.neutral.muted.default' as TokenKey,
    text: 'text.neutral.default.default' as TokenKey,
    threshold: MIN_CONTRAST_NORMAL_AA,
    label: 'body text on muted surface',
  });
  // Brand inverse text on brand hover/active (engine handles `default` via heuristic).
  pairs.push({
    bg: 'bg.brand.default.hover' as TokenKey,
    text: 'text.brand.inverse.hover' as TokenKey,
    threshold: MIN_CONTRAST_LARGE_AA,
    label: 'brand button label (hover)',
  });
  pairs.push({
    bg: 'bg.brand.default.active' as TokenKey,
    text: 'text.brand.inverse.active' as TokenKey,
    threshold: MIN_CONTRAST_LARGE_AA,
    label: 'brand button label (active)',
  });
  return pairs;
}

const VALID_COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[0-9.\s,%-]+\)|transparent)$/;

function validateTokenValue(value: string | undefined): boolean {
  if (!value) return false;
  if (value.includes('NaN')) return false;
  return VALID_COLOR_RE.test(value.trim());
}

function extractHex(value: string | undefined): `#${string}` | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed as `#${string}`;
  // rgba(r,g,b,a) — only safe to compare when alpha is 1; otherwise the visual
  // contrast depends on what's behind the translucent layer.
  const m = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|0?\.\d+|1(?:\.0+)?)\s*)?\)$/
  );
  if (!m) return null;
  const alpha = m[4] !== undefined ? Number(m[4]) : 1;
  if (alpha < 1) return null;
  const toHex = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}` as `#${string}`;
}

function pushFinding(
  findings: VerifyFinding[],
  base: Omit<VerifyFinding, 'severity' | 'code' | 'message'>,
  severity: VerifySeverity,
  code: string,
  message: string,
  extra: Partial<VerifyFinding> = {}
) {
  findings.push({ ...base, severity, code, message, ...extra });
}

export type VerifyOptions = {
  catalog?: ThemeCatalogV2;
  contrastGrid?: number[];
  modes?: Mode[];
  themeIds?: string[];
  extraPairings?: Pairing[];
  // When true, elevate auxiliary contrast failures to 'error' severity so CI
  // blocks on them. Engine-declared pair failures are always errors.
  strictAuxContrast?: boolean;
};

export function verifyThemeEngine(options: VerifyOptions = {}): VerifyReport {
  const catalog = options.catalog ?? DEFAULT_THEME_CATALOG;
  const contrastGrid = options.contrastGrid ?? DEFAULT_CONTRAST_GRID;
  const modes: Mode[] = options.modes ?? ['light', 'dark'];
  const auxSeverity: VerifySeverity = options.strictAuxContrast
    ? 'error'
    : 'warn';
  const auxPairings = [
    ...buildAuxiliaryPairings(),
    ...(options.extraPairings ?? []),
  ];

  const findings: VerifyFinding[] = [];
  let variantsChecked = 0;

  for (const mode of modes) {
    const modeCatalog = catalog[mode] ?? {};
    const themeIds = options.themeIds ?? Object.keys(modeCatalog);

    for (const themeId of themeIds) {
      if (!modeCatalog[themeId]) {
        findings.push({
          severity: 'error',
          mode,
          themeId,
          contrast: -1,
          code: 'unknown-theme',
          message: `Theme "${themeId}" not registered for mode "${mode}".`,
        });
        continue;
      }

      for (const contrast of contrastGrid) {
        variantsChecked += 1;
        const base = { mode, themeId, contrast };

        let resolved: ResolvedThemeV2;
        try {
          resolved = buildThemeV2(
            createDefaultThemeContractV2(mode, { themeId, contrast }),
            catalog
          );
        } catch (err) {
          pushFinding(
            findings,
            base,
            'error',
            'engine-throw',
            `buildThemeV2 threw: ${(err as Error).message}`
          );
          continue;
        }

        // Contract sanity.
        if (resolved.contract.mode !== mode) {
          pushFinding(
            findings,
            base,
            'error',
            'contract-mode-drift',
            `Resolved contract mode "${resolved.contract.mode}" !== requested "${mode}".`
          );
        }
        if (resolved.contract.themeId !== themeId) {
          pushFinding(
            findings,
            base,
            'error',
            'contract-theme-drift',
            `Resolved contract themeId "${resolved.contract.themeId}" !== requested "${themeId}".`
          );
        }

        // Required core tokens.
        for (const key of REQUIRED_CORE_TOKENS) {
          const value = resolved.tokens[key];
          if (!validateTokenValue(value)) {
            pushFinding(
              findings,
              base,
              'error',
              'missing-or-invalid-token',
              `Required token "${key}" is missing or not a valid color.`,
              { tokenKey: key, value }
            );
          }
        }

        // All emitted tokens must be valid CSS colors.
        for (const [key, value] of Object.entries(resolved.tokens)) {
          if (!validateTokenValue(value)) {
            pushFinding(
              findings,
              base,
              'error',
              'invalid-token-value',
              `Token "${key}" resolved to invalid value "${value}".`,
              { tokenKey: key, value }
            );
          }
        }

        // Engine-declared pairs (the engine actively solves for these; if any
        // fail, the solver couldn't converge — that's always an error).
        for (const diag of resolved.diagnostics.contrast) {
          if (!diag.passes) {
            pushFinding(
              findings,
              base,
              'error',
              'engine-contrast-unsolved',
              `Declared pair ${diag.fg} on ${diag.bg}: ratio ${diag.ratio.toFixed(2)} < ${diag.minRequired} (solver failed to converge).`,
              {
                tokenKey: diag.fg,
                ratio: diag.ratio,
                threshold: diag.minRequired,
              }
            );
          }
        }

        // Auxiliary (undeclared) pairings — drift detector.
        for (const pairing of auxPairings) {
          const bg = resolved.tokens[pairing.bg];
          const text = resolved.tokens[pairing.text];
          if (!bg || !text) continue;

          const bgHex = extractHex(bg);
          const textHex = extractHex(text);
          if (!bgHex || !textHex) continue;

          const ratio = contrastRatio(bgHex, textHex);
          if (ratio < pairing.threshold) {
            pushFinding(
              findings,
              base,
              auxSeverity,
              'aux-contrast-below-threshold',
              `${pairing.label}: contrast ${ratio.toFixed(2)} < ${pairing.threshold} (bg=${pairing.bg}, text=${pairing.text}).`,
              {
                tokenKey: pairing.text,
                value: `bg=${bg} / text=${text}`,
                ratio,
                threshold: pairing.threshold,
              }
            );
          }
        }
      }
    }
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;
  return {
    summary: { variantsChecked, errors, warnings },
    findings,
  };
}

export function getDefaultContrastGrid(): number[] {
  return [...DEFAULT_CONTRAST_GRID];
}

export function listRegisteredThemes(
  catalog: ThemeCatalogV2 = DEFAULT_THEME_CATALOG
): Array<{ mode: Mode; id: string }> {
  const out: Array<{ mode: Mode; id: string }> = [];
  for (const mode of ['light', 'dark'] as Mode[]) {
    for (const id of Object.keys(catalog[mode] ?? {})) {
      const def = getColorThemeDefinitionV2(mode, id, catalog);
      if (def.id !== id) {
        throw new Error(
          `Catalog getter drift: asked for "${id}" in mode "${mode}", got "${def.id}".`
        );
      }
      out.push({ mode, id });
    }
  }
  return out;
}

// Expose axis constants for scripts that want to reason about token coverage.
export const TOKEN_AXES = {
  elements: TOKEN_ELEMENTS,
  emphasis: TOKEN_EMPHASIS,
  states: TOKEN_UI_STATES,
  tones: TOKEN_TONES,
} as const;
