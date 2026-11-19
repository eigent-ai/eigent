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

import { contrastRatio, deltaEOK, hexToOklch } from './colorMath';
import type {
  Mode,
  SeedAdmissionFinding,
  ThemeSeedV2,
  ThemeTokens,
} from './types';

export const SEED_HOVER_DELTA_EOK = 0.06;
export const SEED_SELECTED_DELTA_EOK = 0.08;
export const SEED_MIN_MODE_CONTRAST = 3;
export const SEED_MIN_FOREGROUND_CONTRAST = 4.5;

function parseHex(value: string | undefined): `#${string}` | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(trimmed) ? (trimmed as `#${string}`) : null;
}

function deltaBetween(a: `#${string}`, b: `#${string}`): number {
  return deltaEOK(hexToOklch(a), hexToOklch(b));
}

export function admitThemeSeed(
  themeId: string,
  mode: Mode,
  seed: ThemeSeedV2,
  tokens: ThemeTokens,
  foregroundPairs: Record<string, string>
): SeedAdmissionFinding[] {
  const findings: SeedAdmissionFinding[] = [];
  const base = { themeId, mode };

  const inkContrast = contrastRatio(seed.ink, seed.background);
  if (inkContrast < SEED_MIN_MODE_CONTRAST) {
    findings.push({
      ...base,
      code: 'mode-not-established',
      message: `${mode} background ${seed.background} and Ink ${seed.ink} contrast ${inkContrast.toFixed(2)} is below ${SEED_MIN_MODE_CONTRAST}:1.`,
    });
  }

  const accentDefault = parseHex(tokens['bg.brand.default.default']);
  const accentHover = parseHex(tokens['bg.brand.default.hover']);
  const accentSelected = parseHex(tokens['bg.brand.default.selected']);

  if (accentDefault && accentHover) {
    const hoverDelta = deltaBetween(accentDefault, accentHover);
    if (hoverDelta < SEED_HOVER_DELTA_EOK) {
      findings.push({
        ...base,
        code: 'hover-collapse',
        message: `Accent default→hover ΔEOK ${hoverDelta.toFixed(3)} is below ${SEED_HOVER_DELTA_EOK} (seed ${seed.accent}).`,
      });
    }
  }

  if (accentDefault && accentSelected) {
    const selectedDelta = deltaBetween(accentDefault, accentSelected);
    if (selectedDelta < SEED_SELECTED_DELTA_EOK) {
      findings.push({
        ...base,
        code: 'selected-collapse',
        message: `Accent default→selected ΔEOK ${selectedDelta.toFixed(3)} is below ${SEED_SELECTED_DELTA_EOK} (seed ${seed.accent}).`,
      });
    }
  }

  for (const group of ['accent', 'neutral'] as const) {
    for (const emphasis of ['subtle', 'muted', 'default', 'strong'] as const) {
      const pairName = `--ds-${group}-on-${emphasis}`;
      const pairHex = parseHex(foregroundPairs[pairName]);
      const fillToken =
        group === 'accent'
          ? (`bg.brand.${emphasis}.default` as const)
          : (`bg.neutral.${emphasis}.default` as const);
      const fillHex = parseHex(tokens[fillToken]);
      if (!pairHex || !fillHex) {
        findings.push({
          ...base,
          code: 'missing-foreground-pair',
          message: `No conforming foreground pair for ${group} ${emphasis}.`,
        });
        continue;
      }
      const ratio = contrastRatio(pairHex, fillHex);
      if (ratio < SEED_MIN_FOREGROUND_CONTRAST) {
        findings.push({
          ...base,
          code: 'foreground-contrast',
          message: `${group} on-${emphasis} contrast ${ratio.toFixed(2)} is below ${SEED_MIN_FOREGROUND_CONTRAST}:1.`,
        });
      }
    }
  }

  return findings;
}
