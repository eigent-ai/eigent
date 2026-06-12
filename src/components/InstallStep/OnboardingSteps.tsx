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
  DashedLinesBackground,
  DotPatternBackground,
  DottedLinesBackground,
  GridPatternBackground,
  RuledLinesBackground,
} from '@/components/Background';
import { Button } from '@/components/ui/button';
import { LocaleEnum, switchLanguage } from '@/i18n';
import { cn } from '@/lib/utils';
import { useAuthStore, type WorkspaceMainBackground } from '@/store/authStore';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Check,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Step = 1 | 2 | 3;

// ── Language ──────────────────────────────────────────────────────────────────

const LANGUAGE_OPTIONS = [
  { key: 'system', nativeLabel: null },
  { key: LocaleEnum.English, nativeLabel: 'English' },
  { key: LocaleEnum.SimplifiedChinese, nativeLabel: '中文（简体）' },
  { key: LocaleEnum.TraditionalChinese, nativeLabel: '中文（繁體）' },
  { key: LocaleEnum.Japanese, nativeLabel: '日本語' },
  { key: LocaleEnum.Arabic, nativeLabel: 'العربية' },
  { key: LocaleEnum.French, nativeLabel: 'Français' },
  { key: LocaleEnum.German, nativeLabel: 'Deutsch' },
  { key: LocaleEnum.Russian, nativeLabel: 'Русский' },
  { key: LocaleEnum.Spanish, nativeLabel: 'Español' },
  { key: LocaleEnum.Korean, nativeLabel: '한국어' },
  { key: LocaleEnum.Italian, nativeLabel: 'Italiano' },
];

// ── Theme presets ─────────────────────────────────────────────────────────────

const THEME_PRESETS = [
  {
    id: 'eigent',
    label: 'Eigent',
    lightAccent: '#1d1d1d',
    darkAccent: '#ede1db',
  },
  {
    id: 'camel',
    label: 'CAMEL',
    lightAccent: '#4c19e8',
    darkAccent: '#b5afff',
  },
  { id: 'claw', label: 'Claw', lightAccent: '#cc7d5e', darkAccent: '#cc7d5e' },
  {
    id: 'starfish',
    label: 'Starfish',
    lightAccent: '#0169cc',
    darkAccent: '#0169cc',
  },
] as const;

// ── Background pattern metadata (labels resolved via t() in component) ────────

const BG_PATTERN_DEFS: {
  id: WorkspaceMainBackground;
  labelKey: string;
  Component: React.FC | null;
}[] = [
  { id: 'empty', labelKey: 'layout.onboarding-setup-bg-none', Component: null },
  {
    id: 'dots',
    labelKey: 'layout.onboarding-setup-bg-dots',
    Component: DotPatternBackground,
  },
  {
    id: 'blocks',
    labelKey: 'layout.onboarding-setup-bg-blocks',
    Component: GridPatternBackground,
  },
  {
    id: 'ruled',
    labelKey: 'layout.onboarding-setup-bg-ruled',
    Component: RuledLinesBackground,
  },
  {
    id: 'dotted',
    labelKey: 'layout.onboarding-setup-bg-dotted',
    Component: DottedLinesBackground,
  },
  {
    id: 'dashed',
    labelKey: 'layout.onboarding-setup-bg-dashed',
    Component: DashedLinesBackground,
  },
];

// ── Step 1 — Language ─────────────────────────────────────────────────────────

function StepLanguage({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-2">
        <span className="text-heading-base font-bold text-ds-text-neutral-default-default">
          {t('layout.onboarding-setup-language-title')}
        </span>
        <span className="text-body-base mt-2 text-ds-text-neutral-muted-default">
          {t('layout.onboarding-setup-language-subtitle')}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {LANGUAGE_OPTIONS.map(({ key, nativeLabel }) => {
          const active = selected === key;
          const displayLabel =
            nativeLabel ?? t('layout.onboarding-setup-language-system-default');
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className={cn(
                'transition-color flex items-center justify-between rounded-xl border border-solid px-6 py-3 text-body-sm font-medium duration-100',
                active
                  ? 'border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default'
                  : 'border-transparent bg-ds-bg-neutral-default-default text-ds-text-neutral-muted-default hover:border-ds-border-neutral-default-hover hover:bg-ds-bg-neutral-default-hover hover:text-ds-text-neutral-muted-hover'
              )}
            >
              <span>{displayLabel}</span>
              {active && <Check size={14} strokeWidth={2.5} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Step 2 — Theme ────────────────────────────────────────────────────────────

function StepTheme({
  appearanceMode,
  appearance,
  activeThemeId,
  onModeChange,
  onThemeChange,
}: {
  appearanceMode: string;
  appearance: 'light' | 'dark';
  activeThemeId: string;
  onModeChange: (mode: 'light' | 'dark' | 'system') => void;
  onThemeChange: (themeId: string) => void;
}) {
  const { t } = useTranslation();

  const MODES = [
    {
      id: 'system' as const,
      label: t('layout.onboarding-setup-appearance-system'),
      Icon: Monitor,
    },
    {
      id: 'light' as const,
      label: t('layout.onboarding-setup-appearance-light'),
      Icon: Sun,
    },
    {
      id: 'dark' as const,
      label: t('layout.onboarding-setup-appearance-dark'),
      Icon: Moon,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Mode selection */}
      <div className="flex w-full flex-col items-center gap-4">
        <span className="text-heading-base font-bold text-ds-text-neutral-default-default">
          {t('layout.onboarding-setup-appearance-title')}
        </span>
        <span className="text-body-base mt-2 text-ds-text-neutral-muted-default">
          {t('layout.onboarding-setup-language-subtitle')}
        </span>
        <div className="flex w-full gap-3">
          {MODES.map(({ id, label, Icon }) => {
            const active = appearanceMode === id;
            return (
              <button
                key={id}
                onClick={() => onModeChange(id)}
                className={cn(
                  'flex flex-1 flex-col items-center gap-2 rounded-xl border border-solid py-4 transition-colors duration-100',
                  active
                    ? 'border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default'
                    : 'border-transparent bg-ds-bg-neutral-default-default text-ds-text-neutral-muted-default hover:border-ds-border-neutral-default-hover hover:bg-ds-bg-neutral-default-hover hover:text-ds-text-neutral-muted-hover'
                )}
              >
                <Icon size={20} strokeWidth={1.5} />
                <span className="text-body-sm font-medium">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Color theme selection */}
      <div className="flex w-full flex-col items-center gap-4">
        <div>
          <span className="text-body-lg font-semibold text-ds-text-neutral-default-default">
            {t('layout.onboarding-setup-color-theme')}
          </span>
        </div>
        <div className="grid w-full grid-cols-4 gap-3">
          {THEME_PRESETS.map(({ id, label, lightAccent, darkAccent }) => {
            const accent = appearance === 'dark' ? darkAccent : lightAccent;
            const active = activeThemeId === id;
            return (
              <button
                key={id}
                onClick={() => onThemeChange(id)}
                className={cn(
                  'flex flex-col items-center gap-3 rounded-xl border border-solid p-4 transition-colors duration-100',
                  active
                    ? 'border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default'
                    : 'border-transparent bg-ds-bg-neutral-default-default hover:border-ds-border-neutral-default-hover hover:bg-ds-bg-neutral-default-hover'
                )}
              >
                <div
                  className="h-10 w-10 rounded-lg ring-2 ring-offset-2 transition-all"
                  style={
                    {
                      backgroundColor: accent,
                      ringColor: active ? accent : 'transparent',
                      '--tw-ring-color': active ? accent : 'transparent',
                      '--tw-ring-offset-color': 'var(--ds-bg-neutral-default)',
                    } as React.CSSProperties
                  }
                />
                <span
                  className={cn(
                    'text-body-sm font-medium',
                    active
                      ? 'text-ds-text-neutral-default-default'
                      : 'text-ds-text-neutral-muted-default'
                  )}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Step 3 — Background pattern ───────────────────────────────────────────────

function PatternPreviewCard({
  label,
  Component,
  selected,
  onSelect,
}: {
  id: WorkspaceMainBackground;
  label: string;
  Component: React.FC | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'ition-colors flex flex-col items-center gap-2 rounded-xl border border-solid p-2',
        selected
          ? 'border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default'
          : 'border-transparent bg-ds-bg-neutral-default-default hover:border-ds-border-neutral-default-default'
      )}
    >
      <div className="relative isolate h-24 w-full overflow-hidden rounded-xl bg-ds-bg-neutral-subtle-default">
        {Component && <Component />}
        {selected && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-6 w-6 rounded-full bg-ds-bg-neutral-strong-default p-1 shadow-sm">
              <Check
                size={12}
                strokeWidth={2.5}
                className="text-ds-text-neutral-default-default"
              />
            </div>
          </div>
        )}
      </div>
      <span
        className={cn(
          'pb-1 text-body-sm font-medium',
          selected
            ? 'text-ds-text-neutral-default-default'
            : 'text-ds-text-neutral-muted-default'
        )}
      >
        {label}
      </span>
    </button>
  );
}

function StepBackground({
  selected,
  onSelect,
}: {
  selected: WorkspaceMainBackground;
  onSelect: (id: WorkspaceMainBackground) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col items-center gap-2">
        <span className="text-heading-base font-bold text-ds-text-neutral-default-default">
          {t('layout.onboarding-setup-workspace-title')}
        </span>
        <span className="text-body-base mt-2 text-ds-text-neutral-muted-default">
          {t('layout.onboarding-setup-workspace-subtitle')}
        </span>
      </div>
      <div className="grid w-full grid-cols-3 gap-3">
        {BG_PATTERN_DEFS.map(({ id, labelKey, Component }) => (
          <PatternPreviewCard
            key={id}
            id={id}
            label={t(labelKey)}
            Component={Component}
            selected={selected === id}
            onSelect={() => onSelect(id)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function OnboardingSteps({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(1);

  const {
    language,
    appearanceMode,
    appearance,
    lightColorThemeId,
    darkColorThemeId,
    workspaceMainBackground,
    setAppearanceMode,
    setColorThemeForMode,
    setWorkspaceMainBackground,
    setOnboardingCompleted,
    setIsFirstLaunch,
  } = useAuthStore();

  const activeThemeId =
    appearance === 'dark' ? darkColorThemeId : lightColorThemeId;

  const livePattern =
    step === 3
      ? BG_PATTERN_DEFS.find((p) => p.id === workspaceMainBackground)
      : null;
  const LivePatternComponent = livePattern?.Component ?? null;

  const handleLanguage = (key: string) => {
    if (key === 'system') {
      const systemLang = navigator.language.toLowerCase();
      const available = Object.values(LocaleEnum);
      const matched = available.find((l) => systemLang.startsWith(l));
      const langToApply = matched ?? LocaleEnum.English;
      switchLanguage(langToApply);
      useAuthStore.getState().setLanguage('system');
    } else {
      switchLanguage(key as LocaleEnum);
    }
  };

  const handleThemePreset = (themeId: string) => {
    setColorThemeForMode('light', themeId);
    setColorThemeForMode('dark', themeId);
  };

  const handleComplete = () => {
    setOnboardingCompleted(true);
    setIsFirstLaunch(false);
    onComplete();
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl bg-ds-bg-neutral-subtle-default">
      {LivePatternComponent && <LivePatternComponent />}

      <div className="relative z-[1] flex h-full flex-col px-8 py-6">
        {/* Step indicator dots */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {([1, 2, 3] as Step[]).map((s) => (
            <div
              key={s}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                s === step
                  ? 'w-8 bg-ds-text-neutral-default-default'
                  : s < step
                    ? 'w-1.5 bg-ds-text-neutral-default-default opacity-40'
                    : 'w-1.5 bg-ds-text-neutral-muted-default opacity-30'
              )}
            />
          ))}
        </div>

        <div className="flex-1 overflow-auto">
          {step === 1 && (
            <StepLanguage selected={language} onSelect={handleLanguage} />
          )}
          {step === 2 && (
            <StepTheme
              appearanceMode={appearanceMode}
              appearance={appearance}
              activeThemeId={activeThemeId}
              onModeChange={setAppearanceMode}
              onThemeChange={handleThemePreset}
            />
          )}
          {step === 3 && (
            <StepBackground
              selected={workspaceMainBackground}
              onSelect={setWorkspaceMainBackground}
            />
          )}
        </div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <Button
            variant="ghost"
            size="md"
            buttonContent="text"
            buttonRadius="lg"
            className={cn(
              step === 1 ? 'pointer-events-none opacity-0' : 'opacity-100'
            )}
            onClick={() => setStep((s) => (s - 1) as Step)}
          >
            <ArrowLeftIcon />
            {t('layout.back')}
          </Button>

          {step < 3 ? (
            <Button
              variant="primary"
              size="md"
              textWeight="semibold"
              buttonContent="text"
              buttonRadius="lg"
              onClick={() => setStep((s) => (s + 1) as Step)}
            >
              {t('layout.continue')}
              <ArrowRightIcon />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              textWeight="semibold"
              buttonContent="text"
              buttonRadius="lg"
              onClick={handleComplete}
            >
              {t('layout.onboarding-setup-get-started')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
