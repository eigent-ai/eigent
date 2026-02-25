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
import { Cookie, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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
  const { t } = useTranslation();
  const [loginLoading, setLoginLoading] = useState(false);
  const [cookiesLoading, setCookiesLoading] = useState(false);
  const [cookieDomains, setCookieDomains] = useState<CookieDomain[]>([]);
  const [deletingDomain, setDeletingDomain] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

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

  useEffect(() => {
    handleLoadCookies();
  }, []);

  const handleBrowserLogin = async () => {
    setLoginLoading(true);
    try {
      const currentCookieCount = cookieDomains.reduce(
        (sum, item) => sum + item.cookie_count,
        0
      );

      const response = await fetchPost('/browser/login');
      if (response) {
        toast.success('Browser opened successfully for login');
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
                    `Added ${addedCount} cookie${addedCount !== 1 ? 's' : ''}`
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
      toast.error(error?.message || 'Failed to open browser');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLoadCookies = async () => {
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
      toast.error(error?.message || 'Failed to load cookies');
      setCookieDomains([]);
    } finally {
      setCookiesLoading(false);
    }
  };

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

      toast.success(`Deleted cookies for ${mainDomain} and all subdomains`);
      const domainsToRemove = new Set(subdomains.map((item) => item.domain));
      setCookieDomains((prev) =>
        prev.filter((item) => !domainsToRemove.has(item.domain))
      );

      setHasUnsavedChanges(true);
      setShowRestartDialog(true);
    } catch (error: any) {
      toast.error(
        error?.message || `Failed to delete cookies for ${mainDomain}`
      );
    } finally {
      setDeletingDomain(null);
    }
  };

  const handleDeleteAll = async () => {
    setDeletingAll(true);
    try {
      await fetchDelete('/browser/cookies');
      toast.success('Deleted all cookies');
      setCookieDomains([]);

      setHasUnsavedChanges(true);
      setShowRestartDialog(true);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete all cookies');
    } finally {
      setDeletingAll(false);
    }
  };

  const handleRestartApp = () => {
    if (window.electronAPI && window.electronAPI.restartApp) {
      window.electronAPI.restartApp();
    } else {
      toast.error('Restart function not available');
    }
  };

  const handleConfirmRestart = () => {
    setShowRestartDialog(false);
    handleRestartApp();
  };

  return (
    <div className="m-auto flex h-auto w-full flex-1 flex-col">
      <AlertDialog
        isOpen={showRestartDialog}
        onClose={() => setShowRestartDialog(false)}
        onConfirm={handleConfirmRestart}
        title="Cookies Updated"
        message="Cookies have been updated. Would you like to restart the application to use the new cookies?"
        confirmText="Yes, Restart"
        cancelText="No, Add More"
        confirmVariant="information"
      />

      <div className="px-6 pb-6 pt-8 flex w-full items-center justify-between">
        <div className="text-heading-sm font-bold text-text-heading">
          {t('layout.browser-cookie-management')}
        </div>
      </div>

      <div className="gap-4 flex flex-col">
        <div className="rounded-xl border-border-disabled bg-surface-secondary p-6 relative flex w-full flex-col border">
          <div className="right-6 top-6 absolute">
            <Button
              variant="information"
              size="xs"
              onClick={handleRestartApp}
              className="gap-0 ease-in-out justify-center overflow-hidden rounded-full transition-all duration-300"
            >
              <RefreshCw className="flex-shrink-0" />
              <span
                className={`ease-in-out overflow-hidden transition-all duration-300 ${
                  hasUnsavedChanges
                    ? 'pl-2 max-w-[150px] opacity-100'
                    : 'ml-0 max-w-0 opacity-0'
                }`}
              >
                {t('layout.restart-to-apply')}
              </span>
            </Button>
          </div>
          <div className="text-body-sm text-text-label max-w-[600px]">
            {t('layout.browser-cookies-description')}
          </div>
          <div className="mt-4 gap-3 border-border-secondary pt-3 flex w-full flex-col border-[0.5px] border-x-0 border-b-0 border-solid">
            <div className="py-2 flex flex-row items-center justify-between">
              <div className="gap-2 flex flex-row items-center justify-start">
                <div className="text-body-base font-bold text-text-body">
                  {t('layout.cookie-domains')}
                </div>
                {cookieDomains.length > 0 && (
                  <div className="rounded-lg bg-tag-fill-info px-2 text-label-sm font-bold text-text-information">
                    {groupDomainsByMain(cookieDomains).length}
                  </div>
                )}
              </div>

              <div className="gap-2 flex items-center">
                {cookieDomains.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDeleteAll}
                    disabled={deletingAll}
                    className="!text-text-cuation uppercase"
                  >
                    {deletingAll
                      ? t('layout.deleting')
                      : t('layout.delete-all')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLoadCookies}
                  disabled={cookiesLoading}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${cookiesLoading ? 'animate-spin' : ''}`}
                  />
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleBrowserLogin}
                  disabled={loginLoading}
                >
                  <Plus className="h-4 w-4" />
                  {loginLoading
                    ? t('layout.opening')
                    : t('layout.open-browser')}
                </Button>
              </div>
            </div>

            {cookieDomains.length > 0 ? (
              <div className="gap-2 flex flex-col">
                {groupDomainsByMain(cookieDomains).map((group, index) => (
                  <div
                    key={index}
                    className="rounded-xl border-border-disabled bg-surface-tertiary px-4 py-2 flex items-center justify-between border-solid"
                  >
                    <div className="flex w-full flex-col items-start justify-start">
                      <span className="text-body-sm font-bold text-text-body truncate">
                        {group.mainDomain}
                      </span>
                      <span className="mt-1 text-label-xs text-text-label">
                        {group.totalCookies} Cookie
                        {group.totalCookies !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        handleDeleteMainDomain(
                          group.mainDomain,
                          group.subdomains
                        )
                      }
                      disabled={deletingDomain === group.mainDomain}
                      className="ml-3 flex-shrink-0"
                    >
                      <Trash2 className="h-4 w-4 text-text-cuation" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-8 flex flex-col items-center justify-center">
                <Cookie className="mb-4 h-12 w-12 text-icon-secondary opacity-50" />
                <div className="text-body-base font-bold text-text-label text-center">
                  {t('layout.no-cookies-saved-yet')}
                </div>
                <p className="text-label-xs font-medium text-text-label text-center">
                  {t('layout.no-cookies-saved-yet-description')}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="text-label-xs text-text-label w-full text-center">
          For more information, check out our
          <a
            href="https://www.eigent.ai/privacy-policy"
            target="_blank"
            className="ml-1 text-text-information underline"
            rel="noreferrer"
          >
            {t('layout.privacy-policy')}
          </a>
        </div>
      </div>
    </div>
  );
}
