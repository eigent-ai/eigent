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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DEFAULT_COLOR_THEME_ID,
  DEFAULT_THEME_CATALOG,
} from '@/lib/themeTokens/catalog';
import type {
  ColorThemeDefinitionV2,
  Mode,
  ThemeCatalog,
  ThemeSeed,
} from '@/lib/themeTokens/types';
import { useAuthStore, type WorkspaceMainBackground } from '@/store/authStore';
import { Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_EDITABLE_THEME_IDS = [
  'eigent',
  'camel',
  'claw',
  'starfish',
] as const;
const CUSTOM_THEME_IDS = ['whale', 'custom'] as const;

type ThemeOption = {
  id: string;
  label: string;
  isDefault: boolean;
};

function normalizeHexColor(input: string): `#${string}` | null {
  const trimmed = input.trim();
  const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (!HEX_COLOR_RE.test(candidate)) return null;
  return candidate.toLowerCase() as `#${string}`;
}

function buildMergedCatalog(customThemeCatalog: ThemeCatalog): ThemeCatalog {
  return {
    light: {
      ...DEFAULT_THEME_CATALOG.light,
      ...customThemeCatalog.light,
    },
    dark: {
      ...DEFAULT_THEME_CATALOG.dark,
      ...customThemeCatalog.dark,
    },
  };
}

function formatThemeLabel(id: string): string {
  if (id === 'whale') return 'Whale';
  if (id === 'custom') return 'Custom';
  if (id === 'camel') return 'CAMEL';
  if (id === 'claw') return 'Claw';
  if (id === 'starfish') return 'Starfish';
  if (!id) return id;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function ColorSeedEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const normalizedPreview =
    normalizeHexColor(value) ?? 'var(--colors-black-100)';

  return (
    <div className="gap-2 border-ds-border-neutral-subtle-disabled py-4 px-6 flex flex-row items-center justify-between border-x-0 border-t-0 border-b border-solid">
      <div className="text-body-md font-semibold text-ds-text-neutral-default-default w-24">
        {label}
      </div>
      <div className="w-56 gap-2 flex flex-row items-center">
        <Input
          size="sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          note={
            normalizeHexColor(value)
              ? ''
              : 'Hex format: six digits (e.g. 1a2b3c)'
          }
        />
        <div
          className="h-8 w-10 rounded-md border-ds-border-neutral-default-default border-solid"
          style={{ backgroundColor: normalizedPreview }}
        />
      </div>
    </div>
  );
}

function ContrastSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="gap-2 py-4 px-6 flex w-full flex-row items-center justify-between">
      <div className="text-body-md font-semibold text-ds-text-neutral-default-default w-24">
        Contrast
      </div>
      <div className="gap-2 w-80 flex flex-row items-center">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-2 bg-ds-bg-neutral-subtle-disabled accent-ds-bg-brand-default-default my-auto w-full cursor-pointer appearance-none rounded-full"
          aria-label="Theme contrast"
        />
        <div className="w-10 text-body-sm font-semibold text-ds-text-neutral-muted-default text-center">
          {value}
        </div>
      </div>
    </div>
  );
}

export default function AppearanceSettings() {
  const { t } = useTranslation();
  const appearanceMode = useAuthStore((s) => s.appearanceMode);
  const appearance = useAuthStore((s) => s.appearance);
  const setAppearanceMode = useAuthStore((s) => s.setAppearanceMode);
  const lightColorThemeId = useAuthStore((s) => s.lightColorThemeId);
  const darkColorThemeId = useAuthStore((s) => s.darkColorThemeId);
  const setColorThemeForMode = useAuthStore((s) => s.setColorThemeForMode);
  const customThemeCatalog = useAuthStore((s) => s.customThemeCatalog);
  const upsertCustomThemeTemplate = useAuthStore(
    (s) => s.upsertCustomThemeTemplate
  );
  const removeCustomThemeTemplate = useAuthStore(
    (s) => s.removeCustomThemeTemplate
  );
  const themeContrast = useAuthStore((s) => s.themeContrast);
  const setThemeContrast = useAuthStore((s) => s.setThemeContrast);
  const workspaceMainBackground = useAuthStore(
    (s) => s.workspaceMainBackground
  );
  const setWorkspaceMainBackground = useAuthStore(
    (s) => s.setWorkspaceMainBackground
  );

  const activeMode: Mode =
    appearanceMode === 'system' ? appearance : appearanceMode;

  const mergedCatalog = useMemo(
    () => buildMergedCatalog(customThemeCatalog),
    [customThemeCatalog]
  );

  const themeOptions = useMemo<ThemeOption[]>(
    () => [
      ...DEFAULT_EDITABLE_THEME_IDS.map((id) => ({
        id,
        label: formatThemeLabel(id),
        isDefault: true,
      })),
      ...CUSTOM_THEME_IDS.map((id) => ({
        id,
        label: formatThemeLabel(id),
        isDefault: false,
      })),
    ],
    []
  );

  const allowedThemeIds = useMemo(
    () => themeOptions.map((option) => option.id),
    [themeOptions]
  );

  const modeThemeId =
    activeMode === 'dark' ? darkColorThemeId : lightColorThemeId;

  const [activeThemeId, setActiveThemeId] = useState<string>(
    allowedThemeIds.includes(modeThemeId) ? modeThemeId : DEFAULT_COLOR_THEME_ID
  );
  const [accent, setAccent] = useState('');
  const [background, setBackground] = useState('');
  const [ink, setInk] = useState('');

  useEffect(() => {
    const nextThemeId = allowedThemeIds.includes(modeThemeId)
      ? modeThemeId
      : DEFAULT_COLOR_THEME_ID;
    setActiveThemeId(nextThemeId);

    if (modeThemeId !== nextThemeId) {
      setColorThemeForMode(activeMode, nextThemeId);
    }
  }, [activeMode, allowedThemeIds, modeThemeId, setColorThemeForMode]);

  const fallbackSeed =
    DEFAULT_THEME_CATALOG[activeMode][DEFAULT_COLOR_THEME_ID]?.seed ??
    Object.values(DEFAULT_THEME_CATALOG[activeMode])[0]?.seed;

  const activeTheme = useMemo<ColorThemeDefinitionV2 | null>(() => {
    const fromMerged = mergedCatalog[activeMode]?.[activeThemeId];
    if (fromMerged) return fromMerged;

    const fromDefault = DEFAULT_THEME_CATALOG[activeMode]?.[activeThemeId];
    if (fromDefault) {
      return {
        id: activeThemeId,
        mode: activeMode,
        seed: fromDefault.seed,
      };
    }

    if (!fallbackSeed) return null;
    return {
      id: activeThemeId,
      mode: activeMode,
      seed: fallbackSeed,
    };
  }, [activeMode, activeThemeId, fallbackSeed, mergedCatalog]);

  useEffect(() => {
    if (!activeTheme) return;
    setAccent(activeTheme.seed.accent);
    setBackground(activeTheme.seed.background);
    setInk(activeTheme.seed.ink);
  }, [
    activeTheme?.id,
    activeTheme?.seed.accent,
    activeTheme?.seed.background,
    activeTheme?.seed.ink,
    activeMode,
  ]);

  const commitThemeSeed = (
    nextAccent: string,
    nextBackground: string,
    nextInk: string
  ) => {
    const accentHex = normalizeHexColor(nextAccent);
    const backgroundHex = normalizeHexColor(nextBackground);
    const inkHex = normalizeHexColor(nextInk);
    if (!accentHex || !backgroundHex || !inkHex || !activeTheme) return;

    const nextSeed: ThemeSeed = {
      accent: accentHex,
      background: backgroundHex,
      ink: inkHex,
    };

    const current = activeTheme.seed;
    if (
      current.accent === nextSeed.accent &&
      current.background === nextSeed.background &&
      current.ink === nextSeed.ink
    ) {
      return;
    }

    const catalogDefault =
      DEFAULT_THEME_CATALOG[activeMode][activeThemeId]?.seed;
    if (catalogDefault) {
      const ca = normalizeHexColor(catalogDefault.accent);
      const cb = normalizeHexColor(catalogDefault.background);
      const ci = normalizeHexColor(catalogDefault.ink);
      if (
        ca &&
        cb &&
        ci &&
        nextSeed.accent === ca &&
        nextSeed.background === cb &&
        nextSeed.ink === ci
      ) {
        removeCustomThemeTemplate(activeMode, activeThemeId);
        return;
      }
    }

    upsertCustomThemeTemplate(activeMode, activeThemeId, nextSeed);
  };

  const handleAccentChange = (value: string) => {
    setAccent(value);
    commitThemeSeed(value, background, ink);
  };

  const handleBackgroundChange = (value: string) => {
    setBackground(value);
    commitThemeSeed(accent, value, ink);
  };

  const handleInkChange = (value: string) => {
    setInk(value);
    commitThemeSeed(accent, background, value);
  };

  const handleThemeChange = (themeId: string) => {
    setActiveThemeId(themeId);
    setColorThemeForMode(activeMode, themeId);
  };

  const resetActiveTheme = () => {
    if (!activeTheme) return;

    const defaultSeed = DEFAULT_THEME_CATALOG[activeMode][activeThemeId]?.seed;
    if (defaultSeed) {
      removeCustomThemeTemplate(activeMode, activeThemeId);
      setAccent(defaultSeed.accent);
      setBackground(defaultSeed.background);
      setInk(defaultSeed.ink);
      return;
    }

    if (!fallbackSeed) return;
    upsertCustomThemeTemplate(activeMode, activeThemeId, fallbackSeed);
    setAccent(fallbackSeed.accent);
    setBackground(fallbackSeed.background);
    setInk(fallbackSeed.ink);
  };

  return (
    <div className="pt-8 m-auto h-auto w-full flex-1">
      <div className="mb-xl gap-6 flex flex-col">
        <div className="item-center gap-4 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 h-18 flex flex-row items-center justify-between">
          <div className="text-body-base font-bold text-ds-text-neutral-default-default">
            Mode
          </div>

          <Tabs
            value={appearanceMode}
            onValueChange={(value) =>
              setAppearanceMode(value as 'light' | 'dark' | 'system')
            }
          >
            <TabsList appearance="default">
              <TabsTrigger value="light">
                <div className="gap-1 text-label-sm flex items-center">
                  <Sun size={16} />
                  <span>{t('setting.light')}</span>
                </div>
              </TabsTrigger>
              <TabsTrigger value="dark">
                <div className="gap-1 text-label-sm flex items-center">
                  <Moon size={16} />
                  <span>{t('setting.dark')}</span>
                </div>
              </TabsTrigger>
              <TabsTrigger value="system">
                <div className="gap-1 text-label-sm flex items-center">
                  <Monitor size={16} />
                  <span>{t('setting.system-default')}</span>
                </div>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="item-center gap-4 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 flex flex-col">
          <div className="gap-1 flex flex-col">
            <div className="text-body-base font-bold text-ds-text-neutral-default-default">
              Theme Customization
            </div>
          </div>

          <div className="gap-3 flex w-full items-center justify-between">
            <div className="min-w-0 flex-1 overflow-x-auto">
              <Tabs value={activeThemeId} onValueChange={handleThemeChange}>
                <TabsList appearance="default" className="min-w-max">
                  {themeOptions.map((option) => (
                    <TabsTrigger
                      key={option.id}
                      value={option.id}
                      appearance="default"
                    >
                      <div className="gap-1 text-label-sm flex items-center">
                        {option.label}
                      </div>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <Button
              variant="outline"
              size="sm"
              buttonContent="text"
              buttonRadius="full"
              textWeight="semibold"
              onClick={resetActiveTheme}
            >
              <div className="gap-1 text-label-sm flex items-center">
                <RotateCcw />
                <span>Reset</span>
              </div>
            </Button>
          </div>

          <div className="bg-ds-bg-neutral-subtle-default rounded-2xl flex flex-col">
            <ColorSeedEditor
              label="Accent"
              value={accent}
              onChange={handleAccentChange}
            />
            <ColorSeedEditor
              label="Background"
              value={background}
              onChange={handleBackgroundChange}
            />
            <ColorSeedEditor
              label="Ink"
              value={ink}
              onChange={handleInkChange}
            />
            <ContrastSlider value={themeContrast} onChange={setThemeContrast} />
          </div>
        </div>

        <div className="item-center rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 h-18 flex flex-row items-center justify-between">
          <div className="gap-1 flex max-w-[55%] flex-col">
            <div className="text-body-base font-bold text-ds-text-neutral-default-default">
              {t('setting.workspace-main-background')}
            </div>
            <div className="text-body-sm text-ds-text-neutral-muted-default">
              {t('setting.workspace-main-background-description')}
            </div>
          </div>
          <Select
            value={workspaceMainBackground ?? 'empty'}
            onValueChange={(v) =>
              setWorkspaceMainBackground(v as WorkspaceMainBackground)
            }
          >
            <SelectTrigger variant="secondary" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="empty">
                  {t('setting.workspace-main-background-empty')}
                </SelectItem>
                <SelectItem value="dots">
                  {t('setting.workspace-main-background-dots')}
                </SelectItem>
                <SelectItem value="ruled">
                  {t('setting.workspace-main-background-ruled')}
                </SelectItem>
                <SelectItem value="dotted">
                  {t('setting.workspace-main-background-dotted')}
                </SelectItem>
                <SelectItem value="dashed">
                  {t('setting.workspace-main-background-dashed')}
                </SelectItem>
                <SelectItem value="blocks">
                  {t('setting.workspace-main-background-blocks')}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
