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

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DEFAULT_COLOR_THEME_ID,
  DEFAULT_THEME_CATALOG,
} from '@/lib/themeTokens/catalog';
import type { Mode } from '@/lib/themeTokens/types';
import { useAuthStore, type AppearanceMode } from '@/store/authStore';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useMemo } from 'react';

export function ThemeSettings() {
  const appearanceMode = useAuthStore((state) => state.appearanceMode);
  const appearance = useAuthStore((state) => state.appearance);
  const lightColorThemeId = useAuthStore((state) => state.lightColorThemeId);
  const darkColorThemeId = useAuthStore((state) => state.darkColorThemeId);
  const customThemeCatalog = useAuthStore((state) => state.customThemeCatalog);
  const setAppearanceMode = useAuthStore((state) => state.setAppearanceMode);
  const setColorThemeForMode = useAuthStore(
    (state) => state.setColorThemeForMode
  );

  const activeMode: Mode =
    appearanceMode === 'system' ? appearance : appearanceMode;

  const mergedCatalog = useMemo(
    () => ({
      light: { ...DEFAULT_THEME_CATALOG.light, ...customThemeCatalog.light },
      dark: { ...DEFAULT_THEME_CATALOG.dark, ...customThemeCatalog.dark },
    }),
    [customThemeCatalog.dark, customThemeCatalog.light]
  );

  const themeOptions = Object.keys(mergedCatalog[activeMode] ?? {});
  const activeThemeId =
    activeMode === 'dark' ? darkColorThemeId : lightColorThemeId;

  return (
    <div className="space-y-4 rounded-xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-4 border">
      <div>
        <h3 className="mb-2 text-heading-sm font-semibold text-ds-text-neutral-default-default">
          Appearance
        </h3>
        <Tabs
          value={appearanceMode}
          onValueChange={(value) => setAppearanceMode(value as AppearanceMode)}
        >
          <TabsList>
            <TabsTrigger value="light">
              <Sun className="mr-1 h-4 w-4" />
              Light
            </TabsTrigger>
            <TabsTrigger value="dark">
              <Moon className="mr-1 h-4 w-4" />
              Dark
            </TabsTrigger>
            <TabsTrigger value="system">
              <Monitor className="mr-1 h-4 w-4" />
              System
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div>
        <label className="mb-2 text-body-sm font-medium text-ds-text-neutral-default-default block">
          Color theme ({activeMode})
        </label>
        <Select
          value={activeThemeId || DEFAULT_COLOR_THEME_ID}
          onValueChange={(value) => setColorThemeForMode(activeMode, value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select theme" />
          </SelectTrigger>
          <SelectContent>
            {themeOptions.map((themeId) => (
              <SelectItem key={themeId} value={themeId}>
                {themeId.charAt(0).toUpperCase() + themeId.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        variant="outline"
        size="md"
        buttonContent="text"
        onClick={() => {
          setAppearanceMode('system');
          setColorThemeForMode('light', DEFAULT_COLOR_THEME_ID);
          setColorThemeForMode('dark', DEFAULT_COLOR_THEME_ID);
        }}
      >
        Reset theme defaults
      </Button>
    </div>
  );
}
