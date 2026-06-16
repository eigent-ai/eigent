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

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_CATALOG,
  createDefaultThemeContractV2,
} from '@/lib/themeTokens/catalog';
import { contrastRatio } from '@/lib/themeTokens/colorMath';
import {
  applyThemeContractV2,
  buildThemeV2,
  createApcaDiagnosticsReport,
} from '@/lib/themeTokens/engine';
import {
  TOKEN_ELEMENTS,
  TOKEN_EMPHASIS,
  TOKEN_TONES,
  TOKEN_UI_STATES,
  type Mode,
  type ThemeCatalogV2,
} from '@/lib/themeTokens/types';
import baseColorTokens from '@/style/tokens/base.color.json';

function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function isRgba(value: string): boolean {
  return /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|0?\.\d+|1(?:\.0+)?)\s*\)$/i.test(
    value
  );
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function randomHex(): `#${string}` {
  const num = Math.floor(Math.random() * 0xffffff);
  return `#${num.toString(16).padStart(6, '0')}` as `#${string}`;
}

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

type BaseColorTokensShape = {
  fixedShadeScales?: Partial<
    Record<string, Partial<Record<FixedShade, string>>>
  >;
};

const SYSTEM_STATUS_TONES = [
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
] as const;

const DARK_SUBTLE_900_OVERRIDE_TONES = new Set<string>([
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

const FIXED_SHADE_SCALES = (baseColorTokens as BaseColorTokensShape)
  .fixedShadeScales!;

describe('themeTokens v2 engine', () => {
  it('is deterministic for a fixed contract and catalog', () => {
    const contract = createDefaultThemeContractV2('light', {
      themeId: 'eigent',
      contrast: 52,
    });
    const first = buildThemeV2(contract, DEFAULT_THEME_CATALOG);
    const second = buildThemeV2(contract, DEFAULT_THEME_CATALOG);
    expect(first.tokens).toStrictEqual(second.tokens);
    expect(first.cssVariables).toStrictEqual(second.cssVariables);
  });

  it('enforces override precedence with cell override as final authority', () => {
    const baseContract = createDefaultThemeContractV2('light', {
      themeId: 'starfish',
      contrast: 50,
    });
    const base = buildThemeV2(baseContract, DEFAULT_THEME_CATALOG);

    const overridden = buildThemeV2(
      {
        ...baseContract,
        overrides: {
          tone: { brand: { dL: 0.2, dC: 0.05 } },
          emphasis: { default: { dL: -0.1 } },
          state: { default: { dL: -0.08 } },
          cell: { 'brand.default.default': { dL: 0.01, dC: 0.001, dH: 3 } },
        },
      },
      DEFAULT_THEME_CATALOG
    );

    const key = 'bg.brand.default.default';
    expect(overridden.tokens[key]).not.toBe(base.tokens[key]);
  });

  it('produces a full tone × emphasis × state × element matrix', () => {
    const theme = buildThemeV2(
      createDefaultThemeContractV2('dark', { themeId: 'camel', contrast: 63 }),
      DEFAULT_THEME_CATALOG
    );
    const expected =
      TOKEN_ELEMENTS.length *
      TOKEN_TONES.length *
      TOKEN_EMPHASIS.length *
      TOKEN_UI_STATES.length;
    expect(Object.keys(theme.tokens)).toHaveLength(expected);
  });

  it('ensures all generated tokens are valid CSS colors', () => {
    const theme = buildThemeV2(
      createDefaultThemeContractV2('light', {
        themeId: 'claw',
        contrast: 40,
      }),
      DEFAULT_THEME_CATALOG
    );
    for (const value of Object.values(theme.tokens)) {
      if (!value) continue;
      expect(isHex(value) || isRgba(value)).toBe(true);
    }
  });

  it('enforces required WCAG pairs and emits APCA diagnostics', () => {
    const theme = buildThemeV2(
      createDefaultThemeContractV2('dark', { themeId: 'eigent', contrast: 80 }),
      DEFAULT_THEME_CATALOG
    );
    expect(theme.diagnostics.contrast.length).toBeGreaterThan(0);
    for (const item of theme.diagnostics.contrast) {
      expect(item.ratio).toBeGreaterThanOrEqual(item.minRequired);
      expect(Number.isFinite(item.apcaLc)).toBe(true);
    }
    const report = createApcaDiagnosticsReport(theme);
    const parsed = JSON.parse(report) as {
      diagnostics: { contrast: Array<{ apcaLc: number }> };
    };
    expect(parsed.diagnostics.contrast.length).toBe(
      theme.diagnostics.contrast.length
    );
  });

  it('applies and re-applies themes without stale root values', () => {
    const root = document.createElement('div');
    const light = applyThemeContractV2(
      createDefaultThemeContractV2('light', {
        themeId: 'eigent',
        contrast: 40,
      }),
      root
    );
    const firstBg = root.style.getPropertyValue(
      '--ds-bg-neutral-subtle-default'
    );
    expect(firstBg).toBe(light.cssVariables['--ds-bg-neutral-subtle-default']);

    const dark = applyThemeContractV2(
      createDefaultThemeContractV2('dark', { themeId: 'eigent', contrast: 70 }),
      root
    );
    const secondBg = root.style.getPropertyValue(
      '--ds-bg-neutral-subtle-default'
    );
    expect(secondBg).toBe(dark.cssVariables['--ds-bg-neutral-subtle-default']);
    expect(secondBg).not.toBe(firstBg);
  });

  it('keeps neutral surface polarity aligned with mode', () => {
    const light = buildThemeV2(
      createDefaultThemeContractV2('light', {
        themeId: 'eigent',
        contrast: 50,
      }),
      DEFAULT_THEME_CATALOG
    );
    const dark = buildThemeV2(
      createDefaultThemeContractV2('dark', { themeId: 'eigent', contrast: 50 }),
      DEFAULT_THEME_CATALOG
    );

    const lightBg = light.tokens['bg.neutral.subtle.default'] as string;
    const darkBg = dark.tokens['bg.neutral.subtle.default'] as string;
    const lightText = light.tokens['text.neutral.default.default'] as string;
    const darkText = dark.tokens['text.neutral.default.default'] as string;

    expect(relativeLuminance(lightBg)).toBeGreaterThan(
      relativeLuminance(darkBg)
    );
    expect(relativeLuminance(darkText)).toBeGreaterThan(
      relativeLuminance(lightText)
    );
  });

  it('uses legacy-style monotonic contrast response for neutral tokens', () => {
    const lightLow = buildThemeV2(
      createDefaultThemeContractV2('light', { themeId: 'eigent', contrast: 0 }),
      DEFAULT_THEME_CATALOG
    );
    const lightHigh = buildThemeV2(
      createDefaultThemeContractV2('light', {
        themeId: 'eigent',
        contrast: 100,
      }),
      DEFAULT_THEME_CATALOG
    );
    const darkLow = buildThemeV2(
      createDefaultThemeContractV2('dark', { themeId: 'eigent', contrast: 0 }),
      DEFAULT_THEME_CATALOG
    );
    const darkHigh = buildThemeV2(
      createDefaultThemeContractV2('dark', {
        themeId: 'eigent',
        contrast: 100,
      }),
      DEFAULT_THEME_CATALOG
    );

    const lightBgLow = lightLow.tokens['bg.neutral.default.default'] as string;
    const lightBgHigh = lightHigh.tokens[
      'bg.neutral.default.default'
    ] as string;
    const darkBgLow = darkLow.tokens['bg.neutral.default.default'] as string;
    const darkBgHigh = darkHigh.tokens['bg.neutral.default.default'] as string;
    const lightTextLow = lightLow.tokens[
      'text.neutral.muted.default'
    ] as string;
    const lightTextHigh = lightHigh.tokens[
      'text.neutral.muted.default'
    ] as string;
    const darkTextLow = darkLow.tokens['text.neutral.muted.default'] as string;
    const darkTextHigh = darkHigh.tokens[
      'text.neutral.muted.default'
    ] as string;

    expect(relativeLuminance(lightBgHigh)).toBeLessThan(
      relativeLuminance(lightBgLow)
    );
    expect(relativeLuminance(darkBgHigh)).toBeGreaterThan(
      relativeLuminance(darkBgLow)
    );
    expect(relativeLuminance(lightTextHigh)).toBeLessThan(
      relativeLuminance(lightTextLow)
    );
    expect(relativeLuminance(darkTextHigh)).toBeGreaterThan(
      relativeLuminance(darkTextLow)
    );
  });

  it('keeps brand inverse text white for black brand fills', () => {
    const theme = buildThemeV2(
      createDefaultThemeContractV2('light', {
        themeId: 'eigent',
        contrast: 50,
      }),
      DEFAULT_THEME_CATALOG
    );
    expect(theme.tokens['bg.brand.default.default']).toBe('#000000');
    expect(theme.tokens['text.brand.inverse.default']).toBe('#ffffff');
  });

  it('keeps success inverse text as light as brand inverse on filled success (light)', () => {
    const theme = buildThemeV2(
      createDefaultThemeContractV2('light', {
        themeId: 'eigent',
        contrast: 50,
      }),
      DEFAULT_THEME_CATALOG
    );
    const successBg = theme.tokens['bg.success.default.default'] as string;
    const successInverse = theme.tokens[
      'text.success.inverse.default'
    ] as string;
    expect(contrastRatio(successInverse, successBg)).toBeGreaterThanOrEqual(3);
    expect(successInverse).toBe('#ffffff');
  });

  it('maps system status background emphases to fixed shade steps (light vs dark)', () => {
    const lightTheme = buildThemeV2(
      createDefaultThemeContractV2('light', {
        themeId: 'eigent',
        contrast: 50,
      }),
      DEFAULT_THEME_CATALOG
    );
    const darkTheme = buildThemeV2(
      createDefaultThemeContractV2('dark', {
        themeId: 'eigent',
        contrast: 50,
      }),
      DEFAULT_THEME_CATALOG
    );

    for (const tone of SYSTEM_STATUS_TONES) {
      const scale = FIXED_SHADE_SCALES[tone];
      expect(scale).toBeDefined();
      expect(lightTheme.tokens[`bg.${tone}.subtle.default`]).toBe(
        scale?.['50']
      );
      expect(lightTheme.tokens[`bg.${tone}.muted.default`]).toBe(
        scale?.['300']
      );
      expect(lightTheme.tokens[`bg.${tone}.default.default`]).toBe(
        scale?.['600']
      );
      expect(lightTheme.tokens[`bg.${tone}.strong.default`]).toBe(
        scale?.['900']
      );

      const expectedDarkSubtleDefault = DARK_SUBTLE_900_OVERRIDE_TONES.has(tone)
        ? scale?.['900']
        : scale?.['950'];
      expect(darkTheme.tokens[`bg.${tone}.subtle.default`]).toBe(
        expectedDarkSubtleDefault
      );
      expect(darkTheme.tokens[`bg.${tone}.muted.default`]).toBe(scale?.['600']);
      expect(darkTheme.tokens[`bg.${tone}.default.default`]).toBe(
        scale?.['300']
      );
      expect(darkTheme.tokens[`bg.${tone}.strong.default`]).toBe(scale?.['50']);
    }
  });

  it('uses 600-shade transparent status fills with the new alpha schedule', () => {
    const theme = buildThemeV2(
      createDefaultThemeContractV2('light', {
        themeId: 'eigent',
        contrast: 50,
      }),
      DEFAULT_THEME_CATALOG
    );
    const scale = FIXED_SHADE_SCALES.information!;

    expect(theme.tokens['bg.information.transparent.default']).toBe(
      'rgba(37, 99, 235, 0.300)'
    );
    expect(theme.tokens['bg.information.transparent.hover']).toBe(
      'rgba(37, 99, 235, 0.500)'
    );
    expect(theme.tokens['bg.information.transparent.selected']).toBe(
      'rgba(37, 99, 235, 0.700)'
    );
    expect(theme.tokens['bg.information.transparent.disabled']).toBe(
      'rgba(37, 99, 235, 0.100)'
    );
    expect(scale['600']).toBe('#2563eb');
  });

  it('remains stable under randomized theme seeds', () => {
    for (let i = 0; i < 20; i += 1) {
      const mode: Mode = i % 2 === 0 ? 'light' : 'dark';
      const themeId = `random-${i}`;
      const catalog: ThemeCatalogV2 = {
        ...DEFAULT_THEME_CATALOG,
        [mode]: {
          ...DEFAULT_THEME_CATALOG[mode],
          [themeId]: {
            id: themeId,
            mode,
            seed: {
              accent: randomHex(),
              background: randomHex(),
              ink: randomHex(),
            },
          },
        },
      };
      const theme = buildThemeV2(
        createDefaultThemeContractV2(mode, {
          themeId,
          contrast: Math.floor(Math.random() * 101),
        }),
        catalog
      );
      for (const value of Object.values(theme.tokens)) {
        if (!value) continue;
        expect(isHex(value) || isRgba(value)).toBe(true);
      }
    }
  });
});
