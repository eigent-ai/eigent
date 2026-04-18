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
  applyThemeContractV1,
  createDefaultThemeContract,
} from '@/lib/themeTokens';
import { DEFAULT_THEME_CATALOG } from '@/lib/themeTokens/catalog';
import type { Mode } from '@/lib/themeTokens/types';
import { useAuthStore } from '@/store/authStore';
import { useEffect } from 'react';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { appearance, lightColorThemeId, darkColorThemeId, themeContrast } =
    useAuthStore();

  const resolvedMode = appearance === 'dark' ? 'dark' : 'light';
  const colorThemeId =
    resolvedMode === 'dark' ? darkColorThemeId : lightColorThemeId;

  useEffect(() => {
    const root = document.documentElement;

    root.setAttribute('data-theme', resolvedMode);
    root.setAttribute('data-color-theme', colorThemeId);
    root.style.setProperty('--ds-theme-contrast', String(themeContrast));

    // V2 semantic tokens are generated in parallel to legacy tokens.
    // Existing components continue to use legacy variables until migration.
    applyThemeContractV1(
      createDefaultThemeContract(resolvedMode, {
        colorThemeId,
        contrast: themeContrast,
      }),
      root
    );
  }, [colorThemeId, resolvedMode, themeContrast]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const api = {
      listThemes(mode?: Mode) {
        if (mode) {
          return Object.keys(DEFAULT_THEME_CATALOG[mode] ?? {});
        }
        return {
          light: Object.keys(DEFAULT_THEME_CATALOG.light ?? {}),
          dark: Object.keys(DEFAULT_THEME_CATALOG.dark ?? {}),
        };
      },
      setTheme(mode: Mode, themeId: string) {
        useAuthStore.getState().setColorThemeForMode(mode, themeId);
      },
      setContrast(contrast: number) {
        useAuthStore.getState().setThemeContrast(contrast);
      },
      getState() {
        const state = useAuthStore.getState();
        return {
          appearance: state.appearance,
          lightColorThemeId: state.lightColorThemeId,
          darkColorThemeId: state.darkColorThemeId,
          themeContrast: state.themeContrast,
        };
      },
    };

    (
      window as Window & {
        __eigentThemeV1?: typeof api;
      }
    ).__eigentThemeV1 = api;
  }, []);

  return <>{children}</>;
}
