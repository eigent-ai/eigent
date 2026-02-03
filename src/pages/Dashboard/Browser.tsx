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

export default function Browser() {
  const { t } = useTranslation();
  const [loginLoading, setLoginLoading] = useState(false);
  const [cookiesLoading, setCookiesLoading] = useState(false);
  const [cookieDomains, setCookieDomains] = useState<CookieDomain[]>([]);
  const [deletingDomain, setDeletingDomain] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [_cookiesBeforeBrowser, setCookiesBeforeBrowser] = useState<number>(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Extract main domain (e.g., "aa.bb.cc" -> "bb.cc", "www.google.com" -> "google.com")
  const getMainDomain = (domain: string): string => {
    // Remove leading dot if present
    const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;
    const parts = cleanDomain.split('.');

    // For domains with 2 or fewer parts, return as is
    if (parts.length <= 2) {
      return cleanDomain;
    }

    // For domains with more parts, return last 2 parts (main domain)
    return parts.slice(-2).join('.');
  };

  // Group domains by main domain
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

  // Auto-load cookies on component mount
  useEffect(() => {
    handleLoadCookies();
  }, []);

  const handleBrowserLogin = async () => {
    setLoginLoading(true);
    try {
      // Record current cookie count before opening browser
      const currentCookieCount = cookieDomains.reduce(
        (sum, item) => sum + item.cookie_count,
        0
      );
      setCookiesBeforeBrowser(currentCookieCount);

      const response = await fetchPost('/browser/login');
      if (response) {
        toast.success('Browser opened successfully for login');
        // Listen for browser close event to reload cookies
        const checkInterval = setInterval(async () => {
          try {
            // Check if browser is still open by making a request
            // When browser closes, reload cookies
            const statusResponse = await fetchGet('/browser/status');
            if (!statusResponse || !statusResponse.is_open) {
              clearInterval(checkInterval);
              await handleLoadCookies();
              // Check if cookies changed
              const newResponse = await fetchGet('/browser/cookies');
              if (newResponse && newResponse.success) {
                const newDomains = newResponse.domains || [];
                const newCookieCount = newDomains.reduce(
                  (sum: number, item: CookieDomain) => sum + item.cookie_count,
                  0
                );

                if (newCookieCount > currentCookieCount) {
                  // Cookies were added, show success toast and restart dialog
                  const addedCount = newCookieCount - currentCookieCount;
                  toast.success(
                    `Added ${addedCount} cookie${addedCount !== 1 ? 's' : ''}`
                  );
                  setHasUnsavedChanges(true);
                  setShowRestartDialog(true);
                } else if (newCookieCount < currentCookieCount) {
                  // Cookies were deleted (shouldn't happen here, but handle it)
                  setHasUnsavedChanges(true);
                  setShowRestartDialog(true);
                }
              }
            }
          } catch (error) {
            // Browser might be closed
            console.error(error);
            clearInterval(checkInterval);
            await handleLoadCookies();
          }
        }, 500); // Check every 2 seconds
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
      // Delete all subdomains under this main domain
      const deletePromises = subdomains.map((item) =>
        fetchDelete(`/browser/cookies/${encodeURIComponent(item.domain)}`)
      );
      await Promise.all(deletePromises);

      toast.success(`Deleted cookies for ${mainDomain} and all subdomains`);
      // Remove from local state
      const domainsToRemove = new Set(subdomains.map((item) => item.domain));
      setCookieDomains((prev) =>
        prev.filter((item) => !domainsToRemove.has(item.domain))
      );

      // Mark as having unsaved changes
      setHasUnsavedChanges(true);
      // Show restart dialog after successful deletion
      setShowRestartDialog(true);
    } catch (error: any) {
      toast.error(
        error?.message || `Failed to delete cookies for ${mainDomain}`
      );
    } finally {
      setDeletingDomain(null);
    }
  };
  4;
  const handleDeleteAll = async () => {
    setDeletingAll(true);
    try {
      await fetchDelete('/browser/cookies');
      toast.success('Deleted all cookies');
      setCookieDomains([]);

      // Mark as having unsaved changes
      setHasUnsavedChanges(true);
      // Show restart dialog after successful deletion
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
    <div className="m-auto h-auto flex-1">
      {/* Restart Dialog */}
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

      {/* Header Section */}
      <div className="flex w-full">
        <div className="mx-auto flex w-full max-w-[900px] items-center justify-between px-6 pb-4 pt-8">
          <div className="flex w-full flex-row items-center justify-between gap-4">
            <div className="flex flex-col">
              <div className="text-heading-sm font-bold text-text-heading">
                {t('layout.browser-management')}
              </div>
              <p className="max-w-[700px] text-body-sm text-text-label">
                {t('layout.browser-management-description')}.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className="flex w-full">
        <div className="mx-auto flex min-h-[calc(100vh-86px)] w-full max-w-[940px] flex-col items-start justify-center px-6 py-8">
          <div className="relative flex min-h-full w-full flex-col items-center justify-start rounded-xl border-solid border-border-disabled bg-surface-secondary p-6">
            <div className="absolute right-6 top-6">
              <Button
                variant="information"
                size="xs"
                onClick={handleRestartApp}
                className="justify-center gap-0 overflow-hidden rounded-full transition-all duration-300 ease-in-out"
              >
                <RefreshCw className="flex-shrink-0" />
                <span
                  className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    hasUnsavedChanges
                      ? 'max-w-[150px] pl-2 opacity-100'
                      : 'ml-0 max-w-0 opacity-0'
                  }`}
                >
                  {t('layout.restart-to-apply')}
                </span>
              </Button>
            </div>
            <div className="text-body-lg font-bold text-text-heading">
              {t('layout.browser-cookies')}
            </div>
            <p className="max-w-[600px] text-center text-body-sm text-text-label">
              {t('layout.browser-cookies-description')}
            </p>
            {/* Cookies Section */}
            <div className="mt-3 flex w-full max-w-[600px] flex-col gap-3 border-[0.5px] border-x-0 border-b-0 border-solid border-border-secondary pt-3">
              <div className="flex flex-row items-center justify-between py-2">
                <div className="flex flex-row items-center justify-start gap-2">
                  <div className="text-body-base font-bold text-text-body">
                    {t('layout.cookie-domains')}
                  </div>
                  {cookieDomains.length > 0 && (
                    <div className="rounded-lg bg-tag-fill-info px-2 text-label-sm font-bold text-text-information">
                      {groupDomainsByMain(cookieDomains).length}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {cookieDomains.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDeleteAll}
                      disabled={deletingAll}
                      className="uppercase !text-text-cuation"
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
                <div className="flex flex-col gap-2">
                  {groupDomainsByMain(cookieDomains).map((group, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded-xl border-solid border-border-disabled bg-surface-tertiary px-4 py-2"
                    >
                      <div className="flex w-full flex-col items-start justify-start">
                        <span className="truncate text-body-sm font-bold text-text-body">
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
                <div className="flex flex-col items-center justify-center px-4 py-8">
                  <Cookie className="mb-4 h-12 w-12 text-icon-secondary opacity-50" />
                  <div className="text-body-base text-center font-bold text-text-label">
                    {t('layout.no-cookies-saved-yet')}
                  </div>
                  <p className="text-center text-label-xs font-medium text-text-label">
                    {t('layout.no-cookies-saved-yet-description')}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="w-full flex-1 items-center justify-center text-center text-label-xs text-text-label">
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
    </div>
  );
}
