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
import { LocaleEnum, switchLanguage } from '@/i18n';
import { SITE_URL } from '@/lib';
import { useAuthStore } from '@/store/authStore';
import { useInstallationStore } from '@/store/installationStore';
import { LogOut, Settings } from 'lucide-react';
import { createRef, RefObject, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import SettingsSection from '../SettingsSection';
import SettingsSectionPage from '../SettingsSectionPage';

type GeneralSettingsSection = 'all' | 'profile' | 'language' | 'network-proxy';

interface SettingGeneralProps {
  section?: GeneralSettingsSection;
}

export default function SettingGeneral({
  section = 'all',
}: SettingGeneralProps) {
  const { t } = useTranslation();
  const host = useHost();
  const authStore = useAuthStore();

  const resetInstallation = useInstallationStore((state) => state.reset);
  const setNeedsBackendRestart = useInstallationStore(
    (state) => state.setNeedsBackendRestart
  );

  const navigate = useNavigate();
  const [_isLoading, _setIsLoading] = useState(false);
  const language = authStore.language;
  const _setLanguage = authStore.setLanguage;
  const _fullNameRef: RefObject<HTMLInputElement> = createRef();
  const _nickNameRef: RefObject<HTMLInputElement> = createRef();
  const _workDescRef: RefObject<HTMLInputElement> = createRef();
  //Get Chatstore for the active project's task
  const { chatStore } = useChatStoreAdapter();

  // Proxy configuration state
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyLoading, setProxyLoading] = useState(true);
  const [isProxySaving, setIsProxySaving] = useState(false);
  const [proxyNeedsRestart, setProxyNeedsRestart] = useState(false);

  const languageList = [
    {
      key: LocaleEnum.English,
      label: 'English',
    },
    {
      key: LocaleEnum.SimplifiedChinese,
      label: '简体中文',
    },
    {
      key: LocaleEnum.TraditionalChinese,
      label: '繁體中文',
    },
    {
      key: LocaleEnum.Japanese,
      label: '日本語',
    },
    {
      key: LocaleEnum.Arabic,
      label: 'العربية',
    },
    {
      key: LocaleEnum.French,
      label: 'Français',
    },
    {
      key: LocaleEnum.German,
      label: 'Deutsch',
    },
    {
      key: LocaleEnum.Russian,
      label: 'Русский',
    },
    {
      key: LocaleEnum.Spanish,
      label: 'Español',
    },
    {
      key: LocaleEnum.Korean,
      label: '한국어',
    },
    {
      key: LocaleEnum.Italian,
      label: 'Italiano',
    },
  ];

  useEffect(() => {
    // Load proxy configuration from global env
    const loadProxyConfig = async () => {
      try {
        if (host?.electronAPI?.readGlobalEnv) {
          const result = await host.electronAPI.readGlobalEnv('HTTP_PROXY');
          if (result?.value) {
            setProxyUrl(result.value);
          }
        }
      } catch (_error) {
        console.log('No proxy configured');
      } finally {
        setProxyLoading(false);
      }
    };
    void loadProxyConfig();
  }, [host]);

  // Save proxy configuration
  const handleSaveProxy = async () => {
    if (!authStore.email) {
      toast.error(t('setting.proxy-save-failed'));
      return;
    }

    const trimmed = proxyUrl.trim();

    // Validate proxy URL format when non-empty
    if (trimmed) {
      try {
        const parsed = new URL(trimmed);
        if (
          !['http:', 'https:', 'socks5:', 'socks4:'].includes(parsed.protocol)
        ) {
          toast.error(t('setting.proxy-invalid-url'));
          return;
        }
      } catch {
        toast.error(t('setting.proxy-invalid-url'));
        return;
      }
    }

    if (!host?.electronAPI?.envWrite || !host?.electronAPI?.envRemove) {
      toast.error(t('setting.proxy-save-failed'));
      return;
    }

    setIsProxySaving(true);
    try {
      if (trimmed) {
        const result = await host.electronAPI.envWrite(authStore.email, {
          key: 'HTTP_PROXY',
          value: trimmed,
        });
        if (!result?.success) throw new Error('envWrite returned no success');
      } else {
        const result = await host.electronAPI.envRemove(
          authStore.email,
          'HTTP_PROXY'
        );
        if (!result?.success) throw new Error('envRemove returned no success');
      }
      setProxyNeedsRestart(true);
      toast.success(t('setting.proxy-saved-restart-required'));
    } catch (error) {
      console.error('Failed to save proxy:', error);
      toast.error(t('setting.proxy-save-failed'));
    } finally {
      setIsProxySaving(false);
    }
  };

  return (
    <SettingsSectionPage>
      {/* Profile Section */}
      {(section === 'all' || section === 'profile') && (
        <SettingsSection
          title={t('setting.profile')}
          variant="horizontal"
          boxClassName="items-center justify-between gap-4"
        >
          <div className="flex flex-col gap-2">
            <div className="text-body-sm">
              <Trans
                i18nKey="setting.you-are-currently-signed-in-with"
                values={{ email: authStore.email }}
                components={{
                  email: (
                    <span className="text-ds-text-status-splitting-strong-default underline" />
                  ),
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-sm">
            <Button
              onClick={() => {
                window.location.href = `${SITE_URL}/dashboard?email=${authStore.email}`;
              }}
              variant="primary"
              textWeight="semibold"
              buttonContent="text"
              buttonRadius="lg"
              tone="neutral"
              size="sm"
            >
              <Settings />
              {t('setting.manage')}
            </Button>
            <Button
              variant="outline"
              textWeight="semibold"
              buttonContent="text"
              buttonRadius="lg"
              tone="neutral"
              size="sm"
              onClick={() => {
                chatStore?.clearTasks?.();

                resetInstallation(); // Reset installation state for new account
                setNeedsBackendRestart(true); // Mark that backend is restarting

                authStore.logout();
                navigate('/login');
              }}
            >
              <LogOut />
              {t('setting.log-out')}
            </Button>
          </div>
        </SettingsSection>
      )}

      {/* Language Section */}
      {(section === 'all' || section === 'language') && (
        <SettingsSection
          title={t('setting.language')}
          variant="horizontal"
          boxClassName="items-center justify-end"
        >
          <Select value={language} onValueChange={switchLanguage}>
            <SelectTrigger
              variant="secondary"
              className="w-48 !bg-ds-bg-neutral-subtle-default hover:!bg-ds-bg-neutral-subtle-default data-[state=open]:!bg-ds-bg-neutral-subtle-default"
            >
              <SelectValue placeholder={t('setting.select-language')} />
            </SelectTrigger>
            <SelectContent className="border bg-input-bg-default">
              <SelectGroup>
                <SelectItem
                  value="system"
                  className="hover:!bg-ds-bg-neutral-subtle-default focus:!bg-ds-bg-neutral-subtle-default data-[highlighted]:!bg-ds-bg-neutral-subtle-default"
                >
                  {t('setting.system-default')}
                </SelectItem>
                {languageList.map((item) => (
                  <SelectItem
                    key={item.key}
                    value={item.key}
                    className="hover:!bg-ds-bg-neutral-subtle-default focus:!bg-ds-bg-neutral-subtle-default data-[highlighted]:!bg-ds-bg-neutral-subtle-default"
                  >
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsSection>
      )}

      {/* Network Proxy Section */}
      {(section === 'all' || section === 'network-proxy') && (
        <SettingsSection
          title={t('setting.network-proxy')}
          boxClassName="gap-4"
        >
          <div className="flex flex-col gap-1">
            <div className="text-sm leading-13 text-ds-text-neutral-muted-default">
              {t('setting.network-proxy-description')}
            </div>
          </div>
          <Input
            placeholder={t('setting.proxy-placeholder')}
            value={proxyUrl}
            onChange={(e) => {
              setProxyUrl(e.target.value);
              setProxyNeedsRestart(false);
            }}
            className="flex-1"
            size="default"
            disabled={proxyLoading}
            note={
              proxyNeedsRestart ? t('setting.proxy-restart-hint') : undefined
            }
            trailingButton={
              <Button
                variant={proxyNeedsRestart ? 'outline' : 'primary'}
                size="sm"
                onClick={
                  proxyNeedsRestart
                    ? () => host?.electronAPI?.restartApp()
                    : handleSaveProxy
                }
                disabled={proxyLoading || (!proxyNeedsRestart && isProxySaving)}
              >
                {proxyLoading
                  ? t('setting.loading')
                  : proxyNeedsRestart
                    ? t('setting.restart-to-apply')
                    : isProxySaving
                      ? t('setting.saving')
                      : t('setting.save')}
              </Button>
            }
          />
        </SettingsSection>
      )}
    </SettingsSectionPage>
  );
}
