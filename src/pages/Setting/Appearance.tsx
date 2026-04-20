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
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_EDITABLE_THEME_IDS = [
  'eigent',
  'claude',
  'codex',
  'camel',
] as const;
const CUSTOM_THEME_IDS = ['custom-1', 'custom-2'] as const;

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
  if (id === 'custom-1') return 'Custom 1';
  if (id === 'custom-2') return 'Custom 2';
  return id;
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
  const normalizedPreview = normalizeHexColor(value) ?? '#000000';

  return (
    <div className="gap-2 grid grid-cols-[96px_minmax(0,1fr)_40px] items-center">
      <div className="text-body-sm font-semibold text-ds-text-neutral-default-default">
        {label}
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        note={normalizeHexColor(value) ? '' : 'Hex format: #1a2b3c'}
      />
      <div
        className="h-9 w-9 rounded-md border-ds-border-neutral-default-default border"
        style={{ backgroundColor: normalizedPreview }}
      />
    </div>
  );
}

function ModePanel({
  title,
  description,
  active,
  onClick,
}: {
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-xl px-4 py-4 border text-left transition-colors',
        active
          ? 'border-ds-border-brand-default-focus bg-ds-bg-brand-subtle-default'
          : 'border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default hover:bg-ds-bg-neutral-subtle-hover',
      ].join(' ')}
    >
      <div className="text-body-sm font-semibold text-ds-text-neutral-default-default">
        {title}
      </div>
      <div className="mt-1 text-label-sm text-ds-text-neutral-muted-default">
        {description}
      </div>
    </button>
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
    if (!activeTheme || !fallbackSeed) return;

    const isDefaultTheme = DEFAULT_EDITABLE_THEME_IDS.includes(
      activeThemeId as (typeof DEFAULT_EDITABLE_THEME_IDS)[number]
    );

    if (isDefaultTheme) {
      const defaultSeed =
        DEFAULT_THEME_CATALOG[activeMode][activeThemeId]?.seed;
      if (defaultSeed) {
        removeCustomThemeTemplate(activeMode, activeThemeId);
        setAccent(defaultSeed.accent);
        setBackground(defaultSeed.background);
        setInk(defaultSeed.ink);
      }
      return;
    }

    upsertCustomThemeTemplate(activeMode, activeThemeId, fallbackSeed);
    setAccent(fallbackSeed.accent);
    setBackground(fallbackSeed.background);
    setInk(fallbackSeed.ink);
  };

  return (
    <div className="m-auto h-auto w-full flex-1">
      <div className="px-6 pb-6 pt-8 mx-auto flex w-full max-w-[900px] items-center justify-between">
        <div className="gap-4 flex w-full flex-row items-center justify-between">
          <div className="flex flex-col">
            <div className="text-heading-sm font-bold text-ds-text-neutral-default-default">
              {t('setting.appearance-tab')}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-xl gap-6 flex flex-col">
        <div className="item-center gap-4 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 flex flex-col">
          <div className="text-body-base font-bold text-ds-text-neutral-default-default">
            Mode
          </div>

          <div className="gap-3 grid grid-cols-2">
            <ModePanel
              title={t('setting.light')}
              description="Use light mode as the active UI mode."
              active={appearanceMode === 'light'}
              onClick={() => setAppearanceMode('light')}
            />
            <ModePanel
              title={t('setting.dark')}
              description="Use dark mode as the active UI mode."
              active={appearanceMode === 'dark'}
              onClick={() => setAppearanceMode('dark')}
            />
          </div>

          <ModePanel
            title={t('setting.system-default')}
            description={`Follow system. Current system mode: ${appearance}.`}
            active={appearanceMode === 'system'}
            onClick={() => setAppearanceMode('system')}
          />
        </div>

        <div className="item-center gap-4 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 flex flex-col">
          <div className="gap-1 flex flex-col">
            <div className="text-body-base font-bold text-ds-text-neutral-default-default">
              Schema Customization
            </div>
            <div className="text-body-sm text-ds-text-neutral-muted-default">
              4 default themes + 2 custom slots. Changes are auto-saved and
              applied live.
            </div>
          </div>

          <div className="gap-3 flex w-full items-center justify-between">
            <div className="min-w-0 flex-1 overflow-x-auto">
              <Tabs value={activeThemeId} onValueChange={handleThemeChange}>
                <TabsList className="min-w-max">
                  {themeOptions.map((option) => (
                    <TabsTrigger key={option.id} value={option.id}>
                      {option.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <Button variant="secondary" onClick={resetActiveTheme}>
              Reset
            </Button>
          </div>

          <div className="gap-3 flex flex-col">
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
          </div>

          <div className="gap-2 flex flex-col">
            <div className="flex items-center justify-between">
              <div className="text-body-sm font-semibold text-ds-text-neutral-default-default">
                Contract (Contrast)
              </div>
              <div className="text-body-sm font-semibold text-ds-text-neutral-muted-default">
                {themeContrast}
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={themeContrast}
              onChange={(e) => setThemeContrast(Number(e.target.value))}
              className="h-2 bg-ds-bg-neutral-strong-default w-full cursor-pointer appearance-none rounded-full accent-[var(--ds-bg-brand-default-default)]"
              aria-label="Theme contrast"
            />
          </div>
        </div>

        <div className="item-center rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 flex flex-row justify-between">
          <div className="gap-1 flex max-w-[55%] flex-col">
            <div className="text-body-base font-bold text-ds-text-neutral-default-default">
              {t('setting.workspace-main-background')}
            </div>
            <div className="text-body-sm text-ds-text-neutral-muted-default">
              {t('setting.workspace-main-background-description')}
            </div>
          </div>
          <Select
            value={workspaceMainBackground ?? 'none'}
            onValueChange={(v) =>
              setWorkspaceMainBackground(v as WorkspaceMainBackground)
            }
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-input-bg-default border">
              <SelectGroup>
                <SelectItem value="none">
                  {t('setting.workspace-main-background-none')}
                </SelectItem>
                <SelectItem value="dots">
                  {t('setting.workspace-main-background-dots')}
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
