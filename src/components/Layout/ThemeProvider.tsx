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
  applyThemeContractV2,
  createDefaultThemeContractV2,
} from '@/lib/themeTokens';
import { DEFAULT_THEME_CATALOG } from '@/lib/themeTokens/catalog';
import type { Mode } from '@/lib/themeTokens/types';
import { useAuthStore } from '@/store/authStore';
import { useEffect, useMemo, useState } from 'react';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const {
    appearance,
    appearanceMode,
    lightColorThemeId,
    darkColorThemeId,
    customThemeCatalog,
    themeContrast,
    setResolvedAppearance,
  } = useAuthStore();

  const [systemMode, setSystemMode] = useState<Mode>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      setSystemMode(media.matches ? 'dark' : 'light');
    };
    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
    } else {
      media.addListener(update);
    }
    return () => {
      if (typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', update);
      } else {
        media.removeListener(update);
      }
    };
  }, []);

  const resolvedMode: Mode =
    appearanceMode === 'system' ? systemMode : appearanceMode;
  const colorThemeId =
    resolvedMode === 'dark' ? darkColorThemeId : lightColorThemeId;
  const mergedCatalog = useMemo(
    () => ({
      light: {
        ...DEFAULT_THEME_CATALOG.light,
        ...customThemeCatalog.light,
      },
      dark: {
        ...DEFAULT_THEME_CATALOG.dark,
        ...customThemeCatalog.dark,
      },
    }),
    [customThemeCatalog.dark, customThemeCatalog.light]
  );

  useEffect(() => {
    if (appearance !== resolvedMode) {
      setResolvedAppearance(resolvedMode);
    }
  }, [appearance, resolvedMode, setResolvedAppearance]);

  useEffect(() => {
    const root = document.documentElement;

    root.setAttribute('data-theme', resolvedMode);
    root.setAttribute('data-theme-mode', appearanceMode);
    root.setAttribute('data-color-theme', colorThemeId);
    root.style.setProperty('color-scheme', resolvedMode);
    root.style.setProperty('--ds-theme-contrast', String(themeContrast));

    applyThemeContractV2(
      createDefaultThemeContractV2(resolvedMode, {
        themeId: colorThemeId,
        contrast: themeContrast,
      }),
      root,
      mergedCatalog
    );
  }, [
    appearanceMode,
    colorThemeId,
    mergedCatalog,
    resolvedMode,
    themeContrast,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const api = {
      listThemes(mode?: Mode) {
        if (mode) {
          return Object.keys(mergedCatalog[mode] ?? {});
        }
        return {
          light: Object.keys(mergedCatalog.light ?? {}),
          dark: Object.keys(mergedCatalog.dark ?? {}),
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
          appearanceMode: state.appearanceMode,
          lightColorThemeId: state.lightColorThemeId,
          darkColorThemeId: state.darkColorThemeId,
          themeContrast: state.themeContrast,
          customThemeCatalog: state.customThemeCatalog,
        };
      },
    };

    (
      window as Window & {
        __eigentThemeV2?: typeof api;
      }
    ).__eigentThemeV2 = api;
  }, [mergedCatalog]);

  return <>{children}</>;
}
