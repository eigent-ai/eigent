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

import { fetchDelete, fetchGet, fetchPost } from '@/api/http';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { useHost } from '@/host';
import { SITE_URL } from '@/lib';
import { useSettingsResourceCountsStore } from '@/store/settingsResourceCountsStore';
import { Cookie, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SettingsRow, SettingsRowGroup } from '../SettingsRowGroup';
import SettingsSectionLoading from '../SettingsSectionLoading';
import SettingsSectionPage from '../SettingsSectionPage';

interface CookieDomain {
  domain: string;
  cookie_count: number;
  last_access: string;
}

interface GroupedDomain {
  mainDomain: string;
  subdomains: CookieDomain[];
  totalCookies: number;
}

export default function Cookies() {
  const host = useHost();
  const electronAPI = host?.electronAPI;
  const { t } = useTranslation();
  const [loginLoading, setLoginLoading] = useState(false);
  const [cookiesLoading, setCookiesLoading] = useState(true);
  const [cookieDomains, setCookieDomains] = useState<CookieDomain[]>([]);
  const [deletingDomain, setDeletingDomain] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [, setHasUnsavedChanges] = useState(false);
  const setResourceCount = useSettingsResourceCountsStore(
    (state) => state.setCount
  );

  const getMainDomain = (domain: string): string => {
    const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;
    const parts = cleanDomain.split('.');

    if (parts.length <= 2) {
      return cleanDomain;
    }

    return parts.slice(-2).join('.');
  };

  const groupDomainsByMain = (domains: CookieDomain[]): GroupedDomain[] => {
    const grouped = new Map<string, CookieDomain[]>();

    domains.forEach((item) => {
      const mainDomain = getMainDomain(item.domain);
      if (!grouped.has(mainDomain)) {
        grouped.set(mainDomain, []);
      }
      grouped.get(mainDomain)!.push(item);
    });

    return Array.from(grouped.entries())
      .map(([mainDomain, subdomains]) => ({
        mainDomain,
        subdomains,
        totalCookies: subdomains.reduce(
          (sum, item) => sum + item.cookie_count,
          0
        ),
      }))
      .sort((a, b) => a.mainDomain.localeCompare(b.mainDomain));
  };

  const handleBrowserLogin = async () => {
    setLoginLoading(true);
    try {
      const currentCookieCount = cookieDomains.reduce(
        (sum, item) => sum + item.cookie_count,
        0
      );

      const response = await fetchPost('/browser/login');
      if (response) {
        toast.success(t('layout.browser-opened'));
        const checkInterval = setInterval(async () => {
          try {
            const statusResponse = await fetchGet('/browser/status');
            if (!statusResponse || !statusResponse.is_open) {
              clearInterval(checkInterval);
              await handleLoadCookies();
              const newResponse = await fetchGet('/browser/cookies');
              if (newResponse && newResponse.success) {
                const newDomains = newResponse.domains || [];
                const newCookieCount = newDomains.reduce(
                  (sum: number, item: CookieDomain) => sum + item.cookie_count,
                  0
                );

                if (newCookieCount > currentCookieCount) {
                  const addedCount = newCookieCount - currentCookieCount;
                  toast.success(
                    t('layout.cookies-added', { count: addedCount })
                  );
                  setHasUnsavedChanges(true);
                  setShowRestartDialog(true);
                } else if (newCookieCount < currentCookieCount) {
                  setHasUnsavedChanges(true);
                  setShowRestartDialog(true);
                }
              }
            }
          } catch (error) {
            console.error(error);
            clearInterval(checkInterval);
            await handleLoadCookies();
          }
        }, 500);
      }
    } catch (error: any) {
      toast.error(error?.message || t('layout.failed-to-open-browser'));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLoadCookies = useCallback(async () => {
    setCookiesLoading(true);
    try {
      const response = await fetchGet('/browser/cookies');
      if (response && response.success) {
        const domains = response.domains || [];
        setCookieDomains(domains);
      } else {
        setCookieDomains([]);
      }
    } catch (error: any) {
      toast.error(error?.message || t('layout.failed-to-load-cookies'));
      setCookieDomains([]);
    } finally {
      setCookiesLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void handleLoadCookies();
  }, [handleLoadCookies]);

  const handleDeleteMainDomain = async (
    mainDomain: string,
    subdomains: CookieDomain[]
  ) => {
    setDeletingDomain(mainDomain);
    try {
      const deletePromises = subdomains.map((item) =>
        fetchDelete(`/browser/cookies/${encodeURIComponent(item.domain)}`)
      );
      await Promise.all(deletePromises);

      toast.success(
        t('layout.deleted-cookies-for-domain', { domain: mainDomain })
      );
      const domainsToRemove = new Set(subdomains.map((item) => item.domain));
      setCookieDomains((prev) =>
        prev.filter((item) => !domainsToRemove.has(item.domain))
      );

      setHasUnsavedChanges(true);
      setShowRestartDialog(true);
    } catch (error: any) {
      toast.error(
        error?.message ||
          t('layout.failed-to-delete-cookies-for-domain', {
            domain: mainDomain,
          })
      );
    } finally {
      setDeletingDomain(null);
    }
  };

  const handleDeleteAll = async () => {
    setDeletingAll(true);
    try {
      await fetchDelete('/browser/cookies');
      toast.success(t('layout.deleted-all-cookies'));
      setCookieDomains([]);

      setHasUnsavedChanges(true);
      setShowRestartDialog(true);
    } catch (error: any) {
      toast.error(error?.message || t('layout.failed-to-delete-all-cookies'));
    } finally {
      setDeletingAll(false);
    }
  };

  const handleRestartApp = () => {
    if (electronAPI?.restartApp) {
      electronAPI.restartApp();
    } else {
      toast.error(t('layout.restart-not-available'));
    }
  };

  const handleConfirmRestart = () => {
    setShowRestartDialog(false);
    handleRestartApp();
  };

  const groupedDomains = groupDomainsByMain(cookieDomains);

  useEffect(() => {
    if (!cookiesLoading) {
      setResourceCount('cookies', cookieDomains.length);
    }
  }, [cookieDomains.length, cookiesLoading, setResourceCount]);

  return (
    <SettingsSectionPage>
      <AlertDialog
        isOpen={showRestartDialog}
        onClose={() => setShowRestartDialog(false)}
        onConfirm={handleConfirmRestart}
        title={t('layout.cookies-updated')}
        message={t('layout.cookies-updated-message')}
        confirmText={t('layout.yes-restart')}
        cancelText={t('layout.no-add-more')}
        confirmVariant="information"
      />

      <SettingsRowGroup>
        <SettingsRow
          title={t('layout.domains', { defaultValue: 'Domains' })}
          description={t('layout.browser-cookies-description')}
          action={
            <Button
              variant="primary"
              size="sm"
              buttonRadius="full"
              onClick={handleBrowserLogin}
              disabled={loginLoading}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {loginLoading ? t('layout.opening') : t('layout.open-browser')}
            </Button>
          }
        />

        <SettingsRow
          title={
            <span className="flex items-center gap-2">
              <span>
                {t('layout.saved-cookies', { defaultValue: 'Saved cookies' })}
              </span>
              {groupedDomains.length > 0 ? (
                <span className="rounded-lg bg-ds-bg-information-subtle-default px-2 text-ds-text-base font-bold text-ds-text-information-strong-default">
                  {groupedDomains.length}
                </span>
              ) : null}
            </span>
          }
          description={t('layout.saved-cookies-description', {
            defaultValue: 'Cookies saved from browser sessions on this device.',
          })}
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                buttonRadius="full"
                onClick={handleDeleteAll}
                disabled={deletingAll || cookieDomains.length === 0}
                className="!text-ds-text-status-error-strong-default uppercase"
              >
                {deletingAll ? t('layout.deleting') : t('layout.delete-all')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                buttonRadius="full"
                onClick={handleLoadCookies}
                disabled={cookiesLoading}
                aria-label={t('setting.refresh')}
              >
                <RefreshCw
                  className={`h-4 w-4 ${cookiesLoading ? 'animate-spin' : ''}`}
                  aria-hidden
                />
              </Button>
            </div>
          }
        >
          {cookiesLoading && cookieDomains.length === 0 ? (
            <SettingsSectionLoading
              label={t('setting.loading-cookies')}
              rows={2}
              className="py-0"
            />
          ) : cookieDomains.length > 0 ? (
            <div className="flex flex-col gap-2">
              {groupedDomains.map((group, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded-xl bg-ds-neutral-subtle-default px-4 py-2"
                >
                  <div className="flex w-full flex-col items-start justify-start">
                    <span className="truncate text-ds-text-base font-bold text-ds-ink-default-default">
                      {group.mainDomain}
                    </span>
                    <span className="mt-1 text-ds-text-meta text-ds-ink-muted-default">
                      {t('layout.cookie-count', {
                        count: group.totalCookies,
                      })}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    buttonContent="icon-only"
                    onClick={() =>
                      handleDeleteMainDomain(group.mainDomain, group.subdomains)
                    }
                    disabled={deletingDomain === group.mainDomain}
                    className="ml-3 shrink-0"
                    aria-label={t('layout.delete-cookies-for-domain', {
                      domain: group.mainDomain,
                    })}
                  >
                    <Trash2
                      className="h-4 w-4 text-ds-text-status-error-strong-default"
                      aria-hidden
                    />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-8">
              <Cookie className="mb-4 h-12 w-12 text-ds-ink-muted-default opacity-50" />
              <span className="text-center text-ds-text-base font-bold text-ds-ink-muted-default">
                {t('layout.no-cookies-saved-yet')}
              </span>
              <span className="block text-center text-ds-text-meta font-medium text-ds-ink-muted-default">
                {t('layout.no-cookies-saved-yet-description')}
              </span>
            </div>
          )}
        </SettingsRow>
      </SettingsRowGroup>

      <span className="block w-full text-center text-ds-text-meta text-ds-ink-muted-default">
        <span>{t('layout.for-more-info')}</span>
        <a
          href={`${SITE_URL}/privacy-policy`}
          target="_blank"
          className="ml-1 text-ds-text-status-splitting-strong-default underline"
          rel="noreferrer"
        >
          {t('layout.privacy-policy')}
        </a>
      </span>
    </SettingsSectionPage>
  );
}
