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

import light from '@/assets/light.png';
import transparent from '@/assets/transparent.png';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocaleEnum, switchLanguage } from '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { useInstallationStore } from '@/store/installationStore';
import { LogOut, Settings } from 'lucide-react';
import { createRef, RefObject, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

export default function SettingGeneral() {
  const { t } = useTranslation();
  const authStore = useAuthStore();

  const resetInstallation = useInstallationStore((state) => state.reset);
  const setNeedsBackendRestart = useInstallationStore(
    (state) => state.setNeedsBackendRestart
  );

  const navigate = useNavigate();
  const [_isLoading, _setIsLoading] = useState(false);
  const setAppearance = authStore.setAppearance;
  const language = authStore.language;
  const _setLanguage = authStore.setLanguage;
  const appearance = authStore.appearance;
  const _fullNameRef: RefObject<HTMLInputElement> = createRef();
  const _nickNameRef: RefObject<HTMLInputElement> = createRef();
  const _workDescRef: RefObject<HTMLInputElement> = createRef();
  //Get Chatstore for the active project's task
  const { chatStore } = useChatStoreAdapter();

  const themeList = useMemo(() => {
    const platform = window.electronAPI.getPlatform();
    if (platform === 'darwin') {
      return [
        {
          img: light,
          label: 'setting.light',
          value: 'light',
        },
        {
          img: transparent,
          label: 'setting.transparent',
          value: 'transparent',
        },
      ];
    } else {
      return [
        {
          img: light,
          label: 'setting.light',
          value: 'light',
        },
      ];
    }
  }, []);

  // Proxy configuration state
  const [proxyUrl, setProxyUrl] = useState('');
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
      if (window.electronAPI?.readGlobalEnv) {
        try {
          const result = await window.electronAPI.readGlobalEnv('HTTP_PROXY');
          if (result?.value) {
            setProxyUrl(result.value);
          }
        } catch (error) {
          console.log('No proxy configured');
        }
      }
    };
    loadProxyConfig();
  }, []);

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

    setIsProxySaving(true);
    try {
      if (trimmed) {
        await window.electronAPI?.envWrite(authStore.email, {
          key: 'HTTP_PROXY',
          value: trimmed,
        });
      } else {
        await window.electronAPI?.envRemove(authStore.email, 'HTTP_PROXY');
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

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="rounded-2xl bg-surface-secondary px-6 py-4">
        <div className="text-base font-bold leading-12 text-text-body">
          {t('setting.account')}
        </div>
        <div className="mb-4 text-sm leading-13">
          {t('setting.you-are-currently-signed-in-with', {
            email: authStore.email,
          })}
        </div>
        <div className="flex items-center gap-sm">
          <Button
            onClick={() => {
              window.location.href = `https://www.eigent.ai/dashboard?email=${authStore.email}`;
            }}
            variant="primary"
            size="xs"
          >
            <Settings className="h-4 w-4 text-button-primary-icon-default" />
            {t('setting.manage')}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              chatStore.clearTasks();

              resetInstallation(); // Reset installation state for new account
              setNeedsBackendRestart(true); // Mark that backend is restarting

              authStore.logout();
              navigate('/login');
            }}
          >
            <LogOut className="h-4 w-4 text-button-tertiery-text-default" />
            {t('setting.log-out')}
          </Button>
        </div>
      </div>
      <div className="rounded-2xl bg-surface-secondary px-6 py-4">
        <div className="text-text-primary text-base font-bold leading-12">
          {t('setting.language')}
        </div>
        <div className="mt-md">
          <Select value={language} onValueChange={switchLanguage}>
            <SelectTrigger>
              <SelectValue placeholder={t('setting.select-language')} />
            </SelectTrigger>
            <SelectContent className="border bg-input-bg-default">
              <SelectGroup>
                <SelectItem value="system">
                  {t('setting.system-default')}
                </SelectItem>
                {languageList.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="rounded-2xl bg-surface-secondary px-6 py-4">
        <div className="text-text-primary text-base font-bold leading-12">
          {t('setting.appearance')}
        </div>
        <div className="mt-md flex items-center gap-md">
          {themeList.map((item: any) => (
            <div
              key={item.label}
              className="group flex flex-col items-center gap-sm hover:cursor-pointer"
              onClick={() => setAppearance(item.value)}
            >
              <img
                src={item.img}
                className={`group-hover:border-bg-fill-info-primary aspect-[183/91.67] h-[91.67px] rounded-lg border border-solid border-transparent transition-all ${
                  item.value == appearance ? 'border-bg-fill-info-primary' : ''
                }`}
                alt=""
              />
              <div
                className={`text-text-primary text-sm leading-13 group-hover:underline ${
                  item.value == appearance ? 'underline' : ''
                }`}
              >
                {t(item.label)}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl bg-surface-secondary px-6 py-4">
        <div className="text-text-primary text-base font-bold leading-12">
          {t('setting.network-proxy')}
        </div>
        <div className="text-text-secondary mb-4 text-sm leading-13">
          {t('setting.network-proxy-description')}
        </div>
        <div className="flex flex-col gap-md">
          <div className="flex items-center gap-md">
            <Input
              placeholder={t('setting.proxy-placeholder')}
              value={proxyUrl}
              onChange={(e) => {
                setProxyUrl(e.target.value);
                setProxyNeedsRestart(false);
              }}
              className="flex-1"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveProxy}
              disabled={isProxySaving}
            >
              {isProxySaving ? t('setting.saving') : t('setting.save')}
            </Button>
          </div>
          {proxyNeedsRestart && (
            <div className="flex items-center gap-sm">
              <span className="text-sm text-text-warning">
                {t('setting.proxy-restart-hint')}
              </span>
              <Button
                variant="outline"
                size="xs"
                onClick={() => window.electronAPI?.restartApp()}
              >
                {t('setting.restart-to-apply')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
