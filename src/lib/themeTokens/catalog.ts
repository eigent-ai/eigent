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
import contractBase from '../../style/tokens/contracts/default.base.json';
import darkContractRaw from '../../style/tokens/contracts/default.dark.json';
import lightContractRaw from '../../style/tokens/contracts/default.light.json';
import { clamp } from './colorMath';
import { resolveExtends } from './dtcg';
import {
  THEME_CONTRACT_VERSION,
  type ColorThemeDefinitionV2,
  type Mode,
  type ThemeCatalogV2,
  type ThemeContractV2,
  type ThemeSeedV2,
} from './types';

export const DEFAULT_CONTRAST = 43;
export const DEFAULT_THEME_ID = 'eigent';
export const DEFAULT_COLOR_THEME_ID = DEFAULT_THEME_ID;

type BaseColorTokenShape = {
  themes: Record<Mode, Record<string, ThemeSeedV2>>;
};

const BASE = baseColorTokens as BaseColorTokenShape;

function toCatalog(themes: BaseColorTokenShape['themes']): ThemeCatalogV2 {
  return {
    light: Object.fromEntries(
      Object.entries(themes.light).map(([id, seed]) => [
        id,
        { id, mode: 'light', seed },
      ])
    ),
    dark: Object.fromEntries(
      Object.entries(themes.dark).map(([id, seed]) => [
        id,
        { id, mode: 'dark', seed },
      ])
    ),
  };
}

export const DEFAULT_THEME_CATALOG: ThemeCatalogV2 = toCatalog(BASE.themes);

const warnedThemeFallbacks = new Set<string>();

function warnThemeFallback(
  mode: Mode,
  requestedId: string,
  fallbackId: string
): void {
  const key = `${mode}/${requestedId}->${fallbackId}`;
  if (warnedThemeFallbacks.has(key)) return;
  warnedThemeFallbacks.add(key);
  // Vite replaces `import.meta.env.DEV` at build time; guard for non-vite
  // consumers (vitest-node, electron main).
  const isDev =
    typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
  if (!isDev) return;

  console.warn(
    `[themeTokens] theme "${requestedId}" not registered for mode "${mode}"; falling back to "${fallbackId}".`
  );
}

export function getColorThemeDefinitionV2(
  mode: Mode,
  themeId: string,
  catalog: ThemeCatalogV2 = DEFAULT_THEME_CATALOG
): ColorThemeDefinitionV2 {
  const modeThemes = catalog[mode] ?? {};
  const selected = modeThemes[themeId];
  if (selected) return selected;

  const fallback = modeThemes[DEFAULT_THEME_ID];
  if (fallback) {
    warnThemeFallback(mode, themeId, DEFAULT_THEME_ID);
    return fallback;
  }

  const firstEntry = Object.entries(modeThemes)[0];
  if (firstEntry) {
    warnThemeFallback(mode, themeId, firstEntry[0]);
    return firstEntry[1];
  }

  throw new Error(`No color themes configured for mode "${mode}"`);
}

/**
 * Read the system's contrast preference. Returns a recommended value on the
 * 0..100 contrast scale used by {@link ThemeContractV2}. Used as the default
 * when no explicit contrast is provided and surfaced in settings UI so the
 * user can jump back to the system-recommended value.
 */
export function getRecommendedContrast(): number {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return DEFAULT_CONTRAST;
  }
  try {
    if (window.matchMedia('(prefers-contrast: more)').matches) return 80;
    if (window.matchMedia('(prefers-contrast: less)').matches) return 20;
  } catch {
    // Older engines may throw on unsupported media queries; fall through.
  }
  return DEFAULT_CONTRAST;
}

function resolveContractPreset(raw: unknown): ThemeContractV2 {
  const tree = resolveExtends({
    ...(contractBase as Record<string, unknown>),
    contract: raw as Record<string, unknown>,
  });
  const contract = (tree as { contract: ThemeContractV2 }).contract;
  return {
    ...contract,
    version: THEME_CONTRACT_VERSION,
    contrast: clamp(Math.round(contract.contrast), 0, 100),
  };
}

const LIGHT_CONTRACT_PRESET = resolveContractPreset(lightContractRaw);
const DARK_CONTRACT_PRESET = resolveContractPreset(darkContractRaw);

export function createDefaultThemeContractV2(
  mode: Mode,
  overrides?: Partial<Omit<ThemeContractV2, 'version' | 'mode'>>
): ThemeContractV2 {
  const preset = mode === 'dark' ? DARK_CONTRACT_PRESET : LIGHT_CONTRACT_PRESET;
  const resolvedContrast =
    overrides?.contrast ?? preset.contrast ?? getRecommendedContrast();
  return {
    ...preset,
    version: THEME_CONTRACT_VERSION,
    mode,
    themeId: overrides?.themeId ?? preset.themeId ?? DEFAULT_THEME_ID,
    contrast: clamp(Math.round(resolvedContrast), 0, 100),
    overrides: overrides?.overrides ?? preset.overrides,
  };
}
