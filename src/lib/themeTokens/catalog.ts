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

import {
  THEME_CONTRACT_VERSION,
  type ColorThemeDefinitionV1,
  type Mode,
  type ThemeCatalog,
  type ThemeContractV1,
} from './types';

export const DEFAULT_CONTRAST = 43;
export const DEFAULT_COLOR_THEME_ID = 'eigent';

export const DEFAULT_THEME_CATALOG: ThemeCatalog = {
  light: {
    eigent: {
      id: 'eigent',
      mode: 'light',
      seed: {
        accent: '#000000',
        background: '#faf7f6',
        ink: '#1d1d1d',
      },
    },
    claude: {
      id: 'claude',
      mode: 'light',
      seed: {
        accent: '#cc7d5e',
        background: '#f9f9f7',
        ink: '#2d2d2b',
      },
    },
    codex: {
      id: 'codex',
      mode: 'light',
      seed: {
        accent: '#0169cc',
        background: '#ffffff',
        ink: '#0d0d0d',
      },
    },
    camel: {
      id: 'camel',
      mode: 'light',
      seed: {
        accent: '#4c19e8',
        background: '#ffffff',
        ink: '#1d1d1d',
      },
    },
  },
  dark: {
    eigent: {
      id: 'eigent',
      mode: 'dark',
      seed: {
        accent: '#ede1db',
        background: '#1f1f1f',
        ink: '#ffffff',
      },
    },
    claude: {
      id: 'claude',
      mode: 'dark',
      seed: {
        accent: '#cc7d5e',
        background: '#2d2d2b',
        ink: '#f9f9f7',
      },
    },
    codex: {
      id: 'codex',
      mode: 'dark',
      seed: {
        accent: '#0169cc',
        background: '#111111',
        ink: '#fcfcfc',
      },
    },
    camel: {
      id: 'camel',
      mode: 'dark',
      seed: {
        accent: '#b5afff',
        background: '#1f1f1f',
        ink: '#fafafa',
      },
    },
  },
};

export function getColorThemeDefinition(
  mode: Mode,
  colorThemeId: string,
  catalog: ThemeCatalog = DEFAULT_THEME_CATALOG
): ColorThemeDefinitionV1 {
  const modeThemes = catalog[mode] ?? {};
  const selected = modeThemes[colorThemeId];
  if (selected) {
    return selected;
  }

  const fallback = modeThemes[DEFAULT_COLOR_THEME_ID];
  if (fallback) {
    return fallback;
  }

  const firstTheme = Object.values(modeThemes)[0];
  if (firstTheme) {
    return firstTheme;
  }

  throw new Error(`No color themes configured for mode "${mode}"`);
}

export function createDefaultThemeContract(
  mode: Mode,
  overrides?: Partial<Omit<ThemeContractV1, 'version' | 'mode'>>
): ThemeContractV1 {
  return {
    version: THEME_CONTRACT_VERSION,
    mode,
    colorThemeId: overrides?.colorThemeId ?? DEFAULT_COLOR_THEME_ID,
    contrast: overrides?.contrast ?? DEFAULT_CONTRAST,
  };
}
