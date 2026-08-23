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
import { ColorPicker, normalizeHexColor } from '@/components/ui/colorPicker';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
import { SettingsRow, SettingsRowGroup } from '../SettingsRowGroup';
import SettingsSectionPage from '../SettingsSectionPage';

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

function ColorSeedEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const normalizedPreview =
    normalizeHexColor(value) ?? 'var(--colors-black-100)';

  const [open, setOpen] = useState(false);
  const [openKey, setOpenKey] = useState(0);
  const [pending, setPending] = useState(value);

  const handleOpen = (next: boolean) => {
    if (next) {
      setPending(value);
      setOpenKey((k) => k + 1);
    }
    setOpen(next);
  };

  const handleApply = () => {
    const hex = normalizeHexColor(pending);
    if (hex) onChange(hex);
    setOpen(false);
  };

  return (
    <div className="flex flex-row items-center justify-between gap-2 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-disabled px-6 py-4">
      <span className="w-24 text-ds-text-body-large font-semibold text-ds-ink-default-default">
        {label}
      </span>
      <div className="flex w-56 flex-row items-center gap-2">
        <Input
          size="sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          note={normalizeHexColor(value) ? '' : t('setting.hex-color-format')}
        />

        <Popover open={open} onOpenChange={handleOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-x border-y border-solid border-ds-hairline-default-default focus-visible:ring-2 focus-visible:outline-none"
              style={{ backgroundColor: normalizedPreview }}
              title={t('setting.pick-color', { color: label })}
              aria-label={t('setting.pick-color', { color: label })}
            />
          </PopoverTrigger>

          <PopoverContent
            className="flex w-64 flex-col gap-3 rounded-xl bg-ds-neutral-subtle-default p-4"
            side="top"
            align="end"
            sideOffset={8}
          >
            <span className="block text-ds-text-base font-semibold text-ds-ink-default-default">
              {label}
            </span>

            <ColorPicker key={openKey} value={pending} onChange={setPending} />

            <div className="flex flex-row justify-end gap-2">
              <PopoverClose asChild>
                <Button
                  variant="outline"
                  size="sm"
                  buttonContent="text"
                  buttonRadius="full"
                  textWeight="semibold"
                >
                  {t('layout.cancel')}
                </Button>
              </PopoverClose>
              <Button
                variant="primary"
                size="sm"
                buttonContent="text"
                buttonRadius="full"
                textWeight="semibold"
                disabled={!normalizeHexColor(pending)}
                onClick={handleApply}
              >
                {t('setting.apply')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
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
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-row items-center justify-between gap-2 px-6 py-4">
      <span className="w-24 text-ds-text-body-large font-semibold text-ds-ink-default-default">
        {t('setting.theme-contrast')}
      </span>
      <div className="flex w-80 flex-row items-center gap-2">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="my-auto h-2 w-full cursor-pointer appearance-none rounded-full bg-ds-neutral-subtle-disabled accent-ds-accent-default-default"
          aria-label={t('setting.theme-contrast')}
        />
        <span className="w-10 text-center text-ds-text-base font-semibold text-ds-ink-muted-default">
          {value}
        </span>
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
        label: t(`setting.theme-${id}`),
        isDefault: true,
      })),
      ...CUSTOM_THEME_IDS.map((id) => ({
        id,
        label: t(`setting.theme-${id}`),
        isDefault: false,
      })),
    ],
    [t]
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
  }, [activeTheme, activeMode]);

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
    <SettingsSectionPage>
      <SettingsRowGroup>
        <SettingsRow
          title={t('setting.color-mode')}
          description={t('setting.color-mode-description', {
            defaultValue: 'Choose how Eigent looks on this device.',
          })}
          actionClassName="w-[280px]"
          action={
            <Tabs
              className="w-[280px]"
              value={appearanceMode}
              onValueChange={(value) =>
                setAppearanceMode(value as 'light' | 'dark' | 'system')
              }
            >
              <TabsList appearance="default" className="w-full">
                <TabsTrigger value="light" className="flex-1">
                  <span className="flex items-center gap-1 text-ds-text-base">
                    <Sun size={16} />
                    <span>{t('setting.light')}</span>
                  </span>
                </TabsTrigger>
                <TabsTrigger value="dark" className="flex-1">
                  <span className="flex items-center gap-1 text-ds-text-base">
                    <Moon size={16} />
                    <span>{t('setting.dark')}</span>
                  </span>
                </TabsTrigger>
                <TabsTrigger value="system" className="flex-1">
                  <span className="flex items-center gap-1 text-ds-text-base">
                    <Monitor size={16} />
                    <span>{t('setting.system-default')}</span>
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />

        <SettingsRow
          title={t('setting.theme', { defaultValue: 'Theme' })}
          description={t('setting.theme-description', {
            defaultValue: 'Choose the app color theme.',
          })}
          action={
            <div data-theme-select className="flex max-w-full justify-end">
              <Tabs value={activeThemeId} onValueChange={handleThemeChange}>
                <TabsList appearance="default" className="min-w-max">
                  {themeOptions.map((option) => (
                    <TabsTrigger
                      key={option.id}
                      value={option.id}
                      appearance="default"
                    >
                      <span className="flex items-center gap-1 text-ds-text-base">
                        {option.label}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          }
        >
          <div className="flex flex-col rounded-2xl bg-ds-neutral-subtle-default">
            <ColorSeedEditor
              label={t('setting.theme-accent')}
              value={accent}
              onChange={handleAccentChange}
            />
            <ColorSeedEditor
              label={t('setting.theme-background')}
              value={background}
              onChange={handleBackgroundChange}
            />
            <ColorSeedEditor
              label={t('setting.theme-ink')}
              value={ink}
              onChange={handleInkChange}
            />
            <ContrastSlider value={themeContrast} onChange={setThemeContrast} />
          </div>
          <div data-theme-reset-row className="flex w-full justify-end pt-3">
            <Button
              variant="outline"
              size="sm"
              buttonContent="text"
              buttonRadius="full"
              textWeight="semibold"
              onClick={resetActiveTheme}
            >
              <span className="flex items-center gap-1 text-ds-text-base">
                <RotateCcw />
                <span>{t('setting.reset')}</span>
              </span>
            </Button>
          </div>
        </SettingsRow>

        <SettingsRow
          title={t('setting.workspace-main-background')}
          description={t('setting.workspace-main-background-description')}
          actionClassName="w-[280px]"
          action={
            <Select
              value={workspaceMainBackground ?? 'empty'}
              onValueChange={(v) =>
                setWorkspaceMainBackground(v as WorkspaceMainBackground)
              }
            >
              <SelectTrigger variant="secondary" className="w-[280px]">
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
          }
        />
      </SettingsRowGroup>
    </SettingsSectionPage>
  );
}
