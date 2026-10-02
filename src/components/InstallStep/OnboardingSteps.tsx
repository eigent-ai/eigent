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
import { DsText } from '@/components/ui/ds-text';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { LocaleEnum, resolveLocale, switchLanguage } from '@/i18n';
import { recordOnboardingStepCompleted } from '@/lib/events/appEvents';
import { getOnboardingThemePresets } from '@/lib/themeTokens/catalog';
import { cn } from '@/lib/utils';
import {
  DEFAULT_WORK_PROFILE,
  WORK_PROFILE_IDS,
  WORK_PROFILE_LABEL_KEYS,
  type WorkProfileId,
} from '@/lib/workProfiles';
import { useAuthStore, type WorkspaceMainBackground } from '@/store/authStore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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

type Step = 1 | 2 | 3 | 4;

const STEPS: Step[] = [1, 2, 3, 4];
const LAST_STEP: Step = 4;

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

// ── Theme presets (seeds come from base.color.json only) ──────────────────────

const THEME_PRESETS = getOnboardingThemePresets();

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
        <span className="text-ds-text-page font-bold text-ds-ink-default-default">
          {t('layout.onboarding-setup-language-title')}
        </span>
        <span className="mt-2 text-ds-text-base text-ds-ink-muted-default">
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
                'transition-color flex items-center justify-between rounded-xl border border-x border-y border-solid px-6 py-3 text-ds-text-base font-medium duration-100',
                active
                  ? 'border-ds-hairline-default-default bg-ds-neutral-default-default text-ds-ink-default-default'
                  : 'border-transparent bg-ds-neutral-default-default text-ds-ink-muted-default hover:border-ds-hairline-default-hover hover:bg-ds-neutral-default-hover hover:text-ds-ink-muted-hover'
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

// ── Step 2 — Profile ──────────────────────────────────────────────────────────

function StepProfile({
  selected,
  onSelect,
}: {
  selected: WorkProfileId | null;
  onSelect: (id: WorkProfileId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <DsText
          as="h2"
          role="page"
          weight="bold"
          className="text-ds-ink-default-default"
        >
          {t('layout.onboarding-setup-profile-title')}
        </DsText>
        <DsText as="p" role="base" className="mt-2 text-ds-ink-muted-default">
          {t('layout.onboarding-setup-profile-subtitle')}
        </DsText>
      </div>
      {/* Columns follow the onboarding panel width, not the window. */}
      <div className="@container min-w-0">
        <div className="grid grid-cols-1 gap-2 @sm:grid-cols-2 @lg:grid-cols-3">
          {WORK_PROFILE_IDS.map((id) => {
            const active = selected === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(id)}
                className={cn(
                  'flex min-w-0 items-center justify-start rounded-xl border border-x border-y border-solid px-6 py-3 text-left transition-colors duration-100',
                  DS_FOCUS_RING,
                  active
                    ? 'border-ds-accent-default-selected bg-ds-neutral-default-default text-ds-ink-default-default'
                    : 'border-transparent bg-ds-neutral-default-default text-ds-ink-muted-default hover:border-ds-hairline-default-hover hover:bg-ds-neutral-default-hover hover:text-ds-ink-muted-hover'
                )}
              >
                <span
                  className={cn(
                    'min-w-0 text-ds-text-base break-words',
                    active ? 'font-semibold' : 'font-medium'
                  )}
                >
                  {t(WORK_PROFILE_LABEL_KEYS[id])}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Step 3 — Theme ────────────────────────────────────────────────────────────

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
        <span className="text-ds-text-page font-bold text-ds-ink-default-default">
          {t('layout.onboarding-setup-appearance-title')}
        </span>
        <span className="mt-2 text-ds-text-base text-ds-ink-muted-default">
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
                  'flex flex-1 flex-col items-center gap-2 rounded-xl border border-x border-y border-solid py-4 transition-colors duration-100',
                  active
                    ? 'border-ds-hairline-default-default bg-ds-neutral-default-default text-ds-ink-default-default'
                    : 'border-transparent bg-ds-neutral-default-default text-ds-ink-muted-default hover:border-ds-hairline-default-hover hover:bg-ds-neutral-default-hover hover:text-ds-ink-muted-hover'
                )}
              >
                <Icon size={20} strokeWidth={1.5} />
                <span className="text-ds-text-base font-medium">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Color theme selection */}
      <div className="flex w-full flex-col items-center gap-4">
        <div>
          <span className="text-ds-text-section font-semibold text-ds-ink-default-default">
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
                  'flex flex-col items-center gap-3 rounded-xl border border-x border-y border-solid p-4 transition-colors duration-100',
                  active
                    ? 'border-ds-hairline-default-default bg-ds-neutral-default-default'
                    : 'border-transparent bg-ds-neutral-default-default hover:border-ds-hairline-default-hover hover:bg-ds-neutral-default-hover'
                )}
              >
                <div
                  className="h-10 w-10 rounded-lg ring-2 ring-offset-2 transition-[background-color,box-shadow]"
                  style={
                    {
                      backgroundColor: accent,
                      ringColor: active ? accent : 'transparent',
                      '--tw-ring-color': active ? accent : 'transparent',
                      '--tw-ring-offset-color':
                        'var(--ds-neutral-subtle-default)',
                    } as React.CSSProperties
                  }
                />
                <span
                  className={cn(
                    'text-ds-text-base font-medium',
                    active
                      ? 'text-ds-ink-default-default'
                      : 'text-ds-ink-muted-default'
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

// ── Step 4 — Background pattern ───────────────────────────────────────────────

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
        'ition-colors flex flex-col items-center gap-2 rounded-xl border border-x border-y border-solid p-2',
        selected
          ? 'border-ds-hairline-default-default bg-ds-neutral-default-default'
          : 'border-transparent bg-ds-neutral-default-default hover:border-ds-hairline-default-default'
      )}
    >
      <div className="relative isolate h-24 w-full overflow-hidden rounded-xl bg-ds-neutral-subtle-default">
        {Component && <Component />}
        {selected && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-6 w-6 rounded-full bg-ds-neutral-strong-default p-1 shadow-sm">
              <Check
                size={12}
                strokeWidth={2.5}
                className="text-ds-ink-default-default"
              />
            </div>
          </div>
        )}
      </div>
      <span
        className={cn(
          'pb-1 text-ds-text-base font-medium',
          selected ? 'text-ds-ink-default-default' : 'text-ds-ink-muted-default'
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
        <span className="text-ds-text-page font-bold text-ds-ink-default-default">
          {t('layout.onboarding-setup-workspace-title')}
        </span>
        <span className="mt-2 text-ds-text-base text-ds-ink-muted-default">
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
  const [profileSelected, setProfileSelected] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const shouldReduceMotion = useReducedMotion();

  const {
    language,
    appearanceMode,
    appearance,
    lightColorThemeId,
    darkColorThemeId,
    workspaceMainBackground,
    workProfile,
    setAppearanceMode,
    setColorThemeForMode,
    setWorkspaceMainBackground,
    setWorkProfile,
    setOnboardingCompleted,
    setIsFirstLaunch,
  } = useAuthStore();

  const activeThemeId =
    appearance === 'dark' ? darkColorThemeId : lightColorThemeId;

  const livePattern =
    step === LAST_STEP
      ? BG_PATTERN_DEFS.find((p) => p.id === workspaceMainBackground)
      : null;
  const LivePatternComponent = livePattern?.Component ?? null;

  const handleLanguage = (key: string) => {
    if (key === 'system') {
      switchLanguage(resolveLocale(navigator.language));
      useAuthStore.getState().setLanguage('system');
    } else {
      switchLanguage(key as LocaleEnum);
    }
  };

  const handleThemePreset = (themeId: string) => {
    setColorThemeForMode('light', themeId);
    setColorThemeForMode('dark', themeId);
  };

  const stepName = (s: Step) =>
    s === 1
      ? 'language'
      : s === 2
        ? 'profile'
        : s === 3
          ? 'theme'
          : 'background';

  const goNext = () => {
    setDirection(1);
    setStep((s) => (s + 1) as Step);
  };

  const handleContinue = () => {
    recordOnboardingStepCompleted({
      step_id: step,
      step_name: stepName(step),
    });
    goNext();
  };

  const handleSkipProfile = () => {
    setWorkProfile(DEFAULT_WORK_PROFILE);
    setProfileSelected(false);
    recordOnboardingStepCompleted({
      step_id: step,
      step_name: stepName(step),
      phase: 'skipped',
    });
    goNext();
  };

  // Others is a valid explicit choice; Continue requires a card click.
  const canContinue = step !== 2 || profileSelected;

  const handleComplete = () => {
    recordOnboardingStepCompleted({
      step_id: LAST_STEP,
      step_name: stepName(LAST_STEP),
    });
    setOnboardingCompleted(true);
    setIsFirstLaunch(false);
    onComplete();
  };

  const stepVariants = {
    enter: (navigationDirection: 1 | -1) => ({
      opacity: 0,
      transform: shouldReduceMotion
        ? 'translateX(0px)'
        : `translateX(${navigationDirection * 12}px)`,
    }),
    center: {
      opacity: 1,
      transform: 'translateX(0px)',
      transition: {
        duration: shouldReduceMotion ? 0.16 : 0.22,
        ease: [0.23, 1, 0.32, 1] as const,
      },
    },
    exit: (navigationDirection: 1 | -1) => ({
      opacity: 0,
      transform: shouldReduceMotion
        ? 'translateX(0px)'
        : `translateX(${navigationDirection * -8}px)`,
      transition: {
        duration: 0.16,
        ease: [0.23, 1, 0.32, 1] as const,
      },
    }),
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl bg-ds-neutral-subtle-default">
      {LivePatternComponent && <LivePatternComponent />}

      <div className="relative z-[1] flex h-full flex-col px-8 py-6">
        {/* Step indicator dots */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {STEPS.map((s) => (
            <div
              key={s}
              className={cn(
                'h-1.5 rounded-full transition-[background-color,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
                s === step
                  ? 'w-8 bg-ds-text-neutral-default-default'
                  : s < step
                    ? 'w-1.5 bg-ds-text-neutral-default-default opacity-40'
                    : 'w-1.5 bg-ds-text-neutral-muted-default opacity-30'
              )}
            />
          ))}
        </div>

        <div className="scrollbar-always-visible min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
            >
              {step === 1 && (
                <StepLanguage selected={language} onSelect={handleLanguage} />
              )}
              {step === 2 && (
                <StepProfile
                  selected={profileSelected ? workProfile : null}
                  onSelect={(id) => {
                    setWorkProfile(id);
                    setProfileSelected(true);
                  }}
                />
              )}
              {step === 3 && (
                <StepTheme
                  appearanceMode={appearanceMode}
                  appearance={appearance}
                  activeThemeId={activeThemeId}
                  onModeChange={setAppearanceMode}
                  onThemeChange={handleThemePreset}
                />
              )}
              {step === 4 && (
                <StepBackground
                  selected={workspaceMainBackground}
                  onSelect={setWorkspaceMainBackground}
                />
              )}
            </motion.div>
          </AnimatePresence>
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
            onClick={() => {
              setDirection(-1);
              setStep((s) => (s - 1) as Step);
            }}
          >
            <ArrowLeftIcon />
            {t('layout.back')}
          </Button>

          {step < LAST_STEP ? (
            <div className="flex items-center gap-ds-control-gap">
              {step === 2 && (
                <Button
                  variant="ghost"
                  size="md"
                  buttonContent="text"
                  buttonRadius="lg"
                  onClick={handleSkipProfile}
                >
                  {t('layout.onboarding-setup-profile-skip')}
                </Button>
              )}
              <Button
                variant="primary"
                size="md"
                textWeight="semibold"
                buttonContent="text"
                buttonRadius="lg"
                disabled={!canContinue}
                onClick={handleContinue}
              >
                {t('layout.continue')}
                <ArrowRightIcon />
              </Button>
            </div>
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
