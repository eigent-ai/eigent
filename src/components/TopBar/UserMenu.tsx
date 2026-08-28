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

import { proxyFetchGet } from '@/api/http';
import InviteCodeDialog from '@/components/Dialog/InviteCodeDialog';
import { useAppCommand } from '@/components/Layout/AppCommandProvider';
import {
  TOP_BAR_CONTROL_SELECTED_CLASS,
  TOP_BAR_CONTROL_STATE_CLASS,
} from '@/components/TopBar/controlStyles';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconPillToggle } from '@/components/ui/icon-pill-toggle';
import { ShortcutKeycap } from '@/components/ui/shortcut-keycap';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useDesktopShortcutPlatform } from '@/hooks/useDesktopShortcutPlatform';
import { LocaleEnum, resolveLocale, switchLanguage } from '@/i18n';
import { SITE_URL } from '@/lib';
import { cn } from '@/lib/utils';
import { APP_COMMAND } from '@/shared/appCommands';
import { getKeyboardShortcutsHint } from '@/shared/keyboardShortcuts';
import { useAuthStore } from '@/store/authStore';
import { useInstallationStore } from '@/store/installationStore';
import {
  ArrowUpRight,
  Check,
  Gem,
  Gift,
  Keyboard,
  Languages,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const IS_LOCAL_PROXY = import.meta.env.VITE_USE_LOCAL_PROXY === 'true';

function formatPlanName(planKey: unknown): string {
  if (typeof planKey !== 'string' || !planKey.trim()) return 'Free';
  const key = planKey.toLowerCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function formatCredits(value: unknown): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return String(value ?? 0);
  }
  return new Intl.NumberFormat().format(numericValue);
}

const LANGUAGE_OPTIONS: { key: string; label: string }[] = [
  { key: 'system', label: '' },
  { key: LocaleEnum.English, label: 'English' },
  { key: LocaleEnum.SimplifiedChinese, label: '简体中文' },
  { key: LocaleEnum.TraditionalChinese, label: '繁體中文' },
  { key: LocaleEnum.Japanese, label: '日本語' },
  { key: LocaleEnum.Arabic, label: 'العربية' },
  { key: LocaleEnum.French, label: 'Français' },
  { key: LocaleEnum.German, label: 'Deutsch' },
  { key: LocaleEnum.Russian, label: 'Русский' },
  { key: LocaleEnum.Spanish, label: 'Español' },
  { key: LocaleEnum.Korean, label: '한국어' },
  { key: LocaleEnum.Italian, label: 'Italiano' },
];

function applyLanguage(key: string) {
  if (key === 'system') {
    switchLanguage(resolveLocale(navigator.language));
    useAuthStore.getState().setLanguage('system');
    return;
  }
  switchLanguage(key as LocaleEnum);
}

export function UserMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const shortcutPlatform = useDesktopShortcutPlatform();
  const executeAppCommand = useAppCommand();
  const [open, setOpen] = useState(false);
  const [languageSubOpen, setLanguageSubOpen] = useState(false);
  const [inviteCodeDialogOpen, setInviteCodeDialogOpen] = useState(false);
  const [planName, setPlanName] = useState('Free');
  const [credits, setCredits] = useState(0);
  const [planLoading, setPlanLoading] = useState(!IS_LOCAL_PROXY);
  const { chatStore } = useChatStoreAdapter();
  const email = useAuthStore((s) => s.email);
  const username = useAuthStore((s) => s.username);
  const language = useAuthStore((s) => s.language);
  const appearanceMode = useAuthStore((s) => s.appearanceMode);
  const setAppearanceMode = useAuthStore((s) => s.setAppearanceMode);
  const logout = useAuthStore((s) => s.logout);
  const resetInstallation = useInstallationStore((s) => s.reset);
  const setNeedsBackendRestart = useInstallationStore(
    (s) => s.setNeedsBackendRestart
  );
  const keyboardShortcutsHint = getKeyboardShortcutsHint(shortcutPlatform);

  const profileDisplayName = username?.trim() || email?.trim() || '';
  const profileInitial = (profileDisplayName || '?').charAt(0).toUpperCase();

  useEffect(() => {
    if (IS_LOCAL_PROXY || !open) return;

    let cancelled = false;
    const loadPlanAndCredits = async () => {
      setPlanLoading(true);
      const [subscriptionResult, creditsResult] = await Promise.allSettled([
        proxyFetchGet('/api/v1/subscription'),
        proxyFetchGet('/api/v1/user/current_credits'),
      ]);
      if (cancelled) return;

      if (subscriptionResult.status === 'fulfilled') {
        setPlanName(formatPlanName(subscriptionResult.value?.plan_key));
      } else {
        console.error(
          'Failed to load subscription:',
          subscriptionResult.reason
        );
      }

      if (creditsResult.status === 'fulfilled') {
        setCredits(Number(creditsResult.value?.credits) || 0);
      } else {
        console.error('Failed to load credits:', creditsResult.reason);
      }

      setPlanLoading(false);
    };

    void loadPlanAndCredits();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const colorModeOptions = useMemo(
    () =>
      [
        {
          value: 'system' as const,
          label: t('setting.system-default'),
          icon: Monitor,
        },
        {
          value: 'light' as const,
          label: t('setting.light'),
          icon: Sun,
        },
        {
          value: 'dark' as const,
          label: t('setting.dark'),
          icon: Moon,
        },
      ] as const,
    [t]
  );

  const closeLanguageSub = () => setLanguageSubOpen(false);

  const handleMenuOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setLanguageSubOpen(false);
  };

  const handleOpenSubscriptionDashboard = () => {
    window.location.href = `${SITE_URL}/dashboard`;
  };

  const handleOpenSettings = () => {
    executeAppCommand(APP_COMMAND.openSettings);
  };

  const handleOpenKeyboardShortcuts = () => {
    executeAppCommand(APP_COMMAND.keyboardShortcuts);
  };

  const handleLogout = () => {
    chatStore?.clearTasks?.();
    resetInstallation();
    setNeedsBackendRestart(true);
    logout();
    navigate('/login');
  };

  return (
    <>
      <DropdownMenu dir="rtl" open={open} onOpenChange={handleMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            buttonContent="icon-only"
            size="sm"
            buttonRadius="full"
            className={cn(
              'no-drag',
              TOP_BAR_CONTROL_STATE_CLASS,
              open && TOP_BAR_CONTROL_SELECTED_CLASS
            )}
            aria-label={t('setting.profile')}
            aria-expanded={open}
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ds-accent-default-default text-[10px] leading-none font-semibold text-ds-accent-on-default"
              aria-hidden
            >
              {profileInitial}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          className="min-w-56"
          style={{ direction: 'ltr' }}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuLabel
            className="truncate px-2 py-1.5 text-ds-text-base font-normal text-ds-ink-muted-default"
            onPointerEnter={closeLanguageSub}
          >
            {email?.trim() || profileDisplayName || t('setting.profile')}
          </DropdownMenuLabel>

          {!IS_LOCAL_PROXY ? (
            <DropdownMenuItem
              className="gap-2"
              onPointerEnter={closeLanguageSub}
              onSelect={handleOpenSubscriptionDashboard}
            >
              {planLoading ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <Gem className="h-4 w-4" aria-hidden />
              )}
              {planLoading ? (
                <span className="min-w-0 flex-1 truncate">
                  {t('setting.loading', { defaultValue: 'Loading' })}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-bold">{planName}</span>
                  <span className="font-normal">
                    {' · '}
                    {formatCredits(credits)}
                  </span>
                </span>
              )}
              <ArrowUpRight
                className="h-4 w-4 shrink-0 text-ds-ink-muted-default"
                aria-hidden
              />
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuItem
            className="gap-2"
            onPointerEnter={closeLanguageSub}
            onSelect={() => setInviteCodeDialogOpen(true)}
          >
            <Gift className="h-4 w-4" aria-hidden />
            {t('layout.refer-friends')}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <div
            className="flex flex-col gap-1.5 px-2 py-1.5"
            onPointerEnter={closeLanguageSub}
            onPointerDown={(event) => event.preventDefault()}
          >
            <span className="text-ds-text-meta font-medium text-ds-ink-muted-default">
              {t('setting.appearance')}
            </span>
            <IconPillToggle
              className="w-full"
              layoutId="user-menu-color-mode"
              aria-label={t('setting.appearance')}
              value={appearanceMode}
              options={colorModeOptions}
              onValueChange={setAppearanceMode}
            />
          </div>

          <DropdownMenuSub
            open={languageSubOpen}
            onOpenChange={setLanguageSubOpen}
          >
            <DropdownMenuSubTrigger className="gap-2">
              <Languages className="h-4 w-4" aria-hidden />
              {t('setting.language')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className="min-w-44"
              sideOffset={6}
              alignOffset={-4}
              style={{ direction: 'ltr' }}
            >
              {LANGUAGE_OPTIONS.map((option) => {
                const selected = language === option.key;
                return (
                  <DropdownMenuItem
                    key={option.key}
                    className="gap-2"
                    onSelect={(event) => {
                      event.preventDefault();
                      applyLanguage(option.key);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option.key === 'system'
                        ? t('setting.system-default')
                        : option.label}
                    </span>
                    {selected ? (
                      <Check
                        className="h-4 w-4 shrink-0 text-ds-accent-default-default"
                        aria-hidden
                      />
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuItem
            className="gap-2"
            onPointerEnter={closeLanguageSub}
            onSelect={handleOpenSettings}
          >
            <Settings className="h-4 w-4" aria-hidden />
            {t('setting.settings')}
          </DropdownMenuItem>

          <DropdownMenuItem
            className="gap-2"
            onPointerEnter={closeLanguageSub}
            onSelect={handleOpenKeyboardShortcuts}
          >
            <Keyboard className="h-4 w-4" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {t('layout.shortcuts.title')}
            </span>
            <ShortcutKeycap aria-hidden>{keyboardShortcutsHint}</ShortcutKeycap>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-ds-text-error-default-default focus:text-ds-text-error-strong-default data-[highlighted]:text-ds-text-error-default-default [&>svg]:text-ds-icon-error-default-default focus:[&>svg]:text-ds-icon-error-default-default data-[highlighted]:[&>svg]:text-ds-icon-error-default-default"
            onPointerEnter={closeLanguageSub}
            onSelect={handleLogout}
          >
            <LogOut
              className="h-4 w-4 text-ds-icon-error-default-default"
              aria-hidden
            />
            {t('setting.log-out')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <InviteCodeDialog
        open={inviteCodeDialogOpen}
        onOpenChange={setInviteCodeDialogOpen}
      />
    </>
  );
}
