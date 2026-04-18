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
  ColorThemeDefinitionV1,
  Mode,
  ThemeCatalog,
  ThemeSeed,
} from '@/lib/themeTokens/types';
import { useAuthStore, type WorkspaceMainBackground } from '@/store/authStore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type SaveStatus = {
  type: 'success' | 'error';
  message: string;
} | null;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const NEW_TEMPLATE_TAB_ID = '__new_template__';

function normalizeThemeId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

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

function extractThemeList(
  mode: Mode,
  catalog: ThemeCatalog
): ColorThemeDefinitionV1[] {
  return Object.values(catalog[mode] ?? {}).sort((a, b) =>
    a.id.localeCompare(b.id)
  );
}

function nextAutoThemeId(mode: Mode, catalog: ThemeCatalog): string {
  let index = 1;
  while (catalog[mode][`custom-${index}`]) {
    index += 1;
  }
  return `custom-${index}`;
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
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
      <div
        className="h-9 w-9 rounded-md border-ds-border-neutral-default-default border"
        style={{ backgroundColor: normalizedPreview }}
      />
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
  const themeList = useMemo(
    () => extractThemeList(activeMode, mergedCatalog),
    [activeMode, mergedCatalog]
  );
  const selectedThemeId =
    activeMode === 'dark' ? darkColorThemeId : lightColorThemeId;
  const selectedTheme =
    themeList.find((theme) => theme.id === selectedThemeId) ??
    themeList[0] ??
    null;

  const [activeThemeTab, setActiveThemeTab] = useState<string>(
    selectedThemeId || NEW_TEMPLATE_TAB_ID
  );
  const [templateName, setTemplateName] = useState('');
  const [accent, setAccent] = useState('');
  const [background, setBackground] = useState('');
  const [ink, setInk] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);

  useEffect(() => {
    if (!selectedTheme && themeList.length > 0) {
      setColorThemeForMode(activeMode, themeList[0].id);
    }
  }, [activeMode, selectedTheme, setColorThemeForMode, themeList]);

  useEffect(() => {
    if (activeThemeTab === NEW_TEMPLATE_TAB_ID) return;
    const fallbackTab = selectedTheme?.id ?? themeList[0]?.id ?? '';
    if (!fallbackTab) return;
    if (!themeList.some((theme) => theme.id === activeThemeTab)) {
      setActiveThemeTab(fallbackTab);
    }
  }, [activeThemeTab, selectedTheme?.id, themeList]);

  const currentTheme =
    activeThemeTab === NEW_TEMPLATE_TAB_ID
      ? null
      : (themeList.find((theme) => theme.id === activeThemeTab) ??
        selectedTheme ??
        null);
  const isCurrentCustom = Boolean(
    currentTheme && customThemeCatalog[activeMode][currentTheme.id]
  );

  const resetDraftTemplate = useCallback(() => {
    setTemplateName('');
    setAccent('');
    setBackground('');
    setInk('');
  }, []);

  useEffect(() => {
    if (activeThemeTab === NEW_TEMPLATE_TAB_ID) {
      resetDraftTemplate();
      setSaveStatus(null);
      return;
    }

    if (!currentTheme) return;
    setAccent(currentTheme.seed.accent);
    setBackground(currentTheme.seed.background);
    setInk(currentTheme.seed.ink);
    setSaveStatus(null);
  }, [activeThemeTab, currentTheme, resetDraftTemplate]);

  const createTemplate = () => {
    const accentHex = normalizeHexColor(accent);
    const backgroundHex = normalizeHexColor(background);
    const inkHex = normalizeHexColor(ink);
    const explicitId = normalizeThemeId(templateName);
    const themeId = explicitId || nextAutoThemeId(activeMode, mergedCatalog);

    if (!accentHex || !backgroundHex || !inkHex) {
      setSaveStatus({
        type: 'error',
        message: 'Colors must be valid hex values (example: #1a2b3c).',
      });
      return;
    }

    if (mergedCatalog[activeMode][themeId]) {
      setSaveStatus({
        type: 'error',
        message: 'Theme id already exists. Choose another id.',
      });
      return;
    }

    const seed: ThemeSeed = {
      accent: accentHex,
      background: backgroundHex,
      ink: inkHex,
    };

    upsertCustomThemeTemplate(activeMode, themeId, seed);
    resetDraftTemplate();
    setSaveStatus({
      type: 'success',
      message: `Created "${themeId}" in ${activeMode} themes.`,
    });
  };

  const deleteTemplate = () => {
    if (!currentTheme) return;
    if (!isCurrentCustom) {
      setSaveStatus({
        type: 'error',
        message: 'Built-in themes cannot be deleted.',
      });
      return;
    }

    const fallbackTheme =
      themeList.find(
        (theme) =>
          theme.id !== currentTheme.id && theme.id === DEFAULT_COLOR_THEME_ID
      ) ?? themeList.find((theme) => theme.id !== currentTheme.id);

    if (fallbackTheme) {
      setColorThemeForMode(activeMode, fallbackTheme.id);
      setActiveThemeTab(fallbackTheme.id);
    }
    removeCustomThemeTemplate(activeMode, currentTheme.id);
    setSaveStatus({
      type: 'success',
      message: `Deleted "${currentTheme.id}".`,
    });
  };

  const openDraftTemplate = () => {
    setActiveThemeTab(NEW_TEMPLATE_TAB_ID);
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
          <Select
            value={appearanceMode}
            onValueChange={(value) =>
              setAppearanceMode(value as Mode | 'system')
            }
          >
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-input-bg-default border">
              <SelectGroup>
                <SelectItem value="light">{t('setting.light')}</SelectItem>
                <SelectItem value="dark">{t('setting.dark')}</SelectItem>
                <SelectItem value="system">
                  {t('setting.system-default')}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="text-body-sm text-ds-text-neutral-muted-default">
            {appearanceMode === 'system'
              ? `Following system. Current system mode: ${appearance}.`
              : `Using ${appearanceMode} mode.`}
          </div>
        </div>

        <div className="item-center gap-4 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 flex flex-col">
          <div className="gap-1 flex flex-col">
            <div className="text-body-base font-bold text-ds-text-neutral-default-default">
              Schema Customization
            </div>
            <div className="text-body-sm text-ds-text-neutral-muted-default">
              Theme tabs are mode-specific. Select a current theme for
              Add/Delete. Use New Template for Create.
            </div>
          </div>

          <div className="gap-3 flex w-full flex-col">
            <div className="w-full overflow-x-auto">
              <Tabs
                value={activeThemeTab}
                onValueChange={(value) => {
                  setSaveStatus(null);
                  setActiveThemeTab(value);
                  if (value !== NEW_TEMPLATE_TAB_ID) {
                    setColorThemeForMode(activeMode, value);
                  }
                }}
              >
                <TabsList className="min-w-max">
                  {themeList.map((theme) => {
                    const isCustom = Boolean(
                      customThemeCatalog[activeMode][theme.id]
                    );
                    return (
                      <TabsTrigger key={theme.id} value={theme.id}>
                        {isCustom ? `${theme.id} *` : theme.id}
                      </TabsTrigger>
                    );
                  })}
                  <TabsTrigger value={NEW_TEMPLATE_TAB_ID}>
                    + New Template
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="gap-2 flex">
              {activeThemeTab === NEW_TEMPLATE_TAB_ID ? (
                <Button variant="secondary" onClick={createTemplate}>
                  Create
                </Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={openDraftTemplate}>
                    Add
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={deleteTemplate}
                    disabled={!isCurrentCustom}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>

          <Input
            title="New Template ID"
            placeholder="my-theme-template (optional, auto-generated when empty)"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            note="Use lowercase letters, numbers, hyphen, or underscore."
          />

          <div className="gap-3 flex flex-col">
            <ColorSeedEditor
              label="Accent"
              value={accent}
              onChange={setAccent}
            />
            <ColorSeedEditor
              label="Background"
              value={background}
              onChange={setBackground}
            />
            <ColorSeedEditor label="Ink" value={ink} onChange={setInk} />
          </div>

          <div
            className="h-16 rounded-lg border-ds-border-neutral-default-default w-full overflow-hidden border"
            style={{
              backgroundColor: normalizeHexColor(background) ?? '#ffffff',
            }}
          >
            <div className="flex h-full">
              <div
                className="w-4 shrink-0 self-stretch"
                style={{
                  backgroundColor: normalizeHexColor(accent) ?? '#000000',
                }}
              />
              <div className="min-w-0 p-2 flex flex-1 flex-col justify-end">
                <span
                  className="text-label-sm font-semibold truncate text-left capitalize"
                  style={{ color: normalizeHexColor(ink) ?? '#1d1d1d' }}
                >
                  Preview
                </span>
              </div>
            </div>
          </div>

          {saveStatus ? (
            <div
              className={
                saveStatus.type === 'error'
                  ? 'text-body-sm text-ds-text-status-error-strong-default'
                  : 'text-body-sm text-ds-text-status-completed-strong-default'
              }
            >
              {saveStatus.message}
            </div>
          ) : null}
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
