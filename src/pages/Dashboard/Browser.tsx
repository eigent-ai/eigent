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
import VerticalNavigation from '@/components/Navigation';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import {
  Cookie,
  Globe,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
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

interface CdpBrowser {
  id: string;
  port: number;
  isExternal: boolean;
  name?: string;
  addedAt: number;
}

export default function Browser() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('connection');
  const [loginLoading, setLoginLoading] = useState(false);
  const [cookiesLoading, setCookiesLoading] = useState(false);
  const [cookieDomains, setCookieDomains] = useState<CookieDomain[]>([]);
  const [deletingDomain, setDeletingDomain] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [showCookieRestartDialog, setShowCookieRestartDialog] = useState(false);

  // CDP port configuration
  const [cdpPort, setCdpPort] = useState<number>(9223);

  // CDP Browser Pool
  const [cdpBrowsers, setCdpBrowsers] = useState<CdpBrowser[]>([]);
  const [deletingBrowser, setDeletingBrowser] = useState<string | null>(null);
  const [browserToRemove, setBrowserToRemove] = useState<CdpBrowser | null>(
    null
  );

  // Connect Existing Browser dialog
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [connectPort, setConnectPort] = useState('');
  const [connectChecking, setConnectChecking] = useState(false);
  const [connectError, setConnectError] = useState('');

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
    // Load current browser port on mount
    loadCurrentBrowserPort();
    // Load CDP browser pool
    loadCdpBrowsers();
  }, []);

  // Listen for CDP pool push updates from main process (health-check removes dead browsers)
  useEffect(() => {
    if (!window.electronAPI?.onCdpPoolChanged) return;
    const cleanup = window.electronAPI.onCdpPoolChanged(
      (browsers: CdpBrowser[]) => {
        setCdpBrowsers(browsers);
      }
    );
    return cleanup;
  }, []);

  const loadCurrentBrowserPort = async () => {
    if (window.electronAPI?.getBrowserPort) {
      const port = await window.electronAPI.getBrowserPort();
      setCdpPort(port);
    }
  };

  const loadCdpBrowsers = async () => {
    if (window.electronAPI?.getCdpBrowsers) {
      try {
        const browsers = await window.electronAPI.getCdpBrowsers();
        setCdpBrowsers(browsers);
      } catch (error) {
        console.error('Failed to load CDP browsers:', error);
      }
    }
  };

  const handleRemoveBrowser = async (browserId: string) => {
    setDeletingBrowser(browserId);
    try {
      if (window.electronAPI?.removeCdpBrowser) {
        const result = await window.electronAPI.removeCdpBrowser(browserId);
        if (result.success) {
          toast.success(t('layout.browser-removed'));
        } else {
          toast.error(result.error || t('layout.failed-to-remove-browser'));
        }
      }
    } catch (error: any) {
      toast.error(error.message || t('layout.failed-to-remove-browser'));
    } finally {
      setDeletingBrowser(null);
      setBrowserToRemove(null);
    }
  };

  const handleOpenNewBrowser = async () => {
    try {
      toast.loading(t('layout.launching-browser', { port: '...' }), {
        id: 'launch-browser',
      });

      // Call backend to auto-assign port and launch browser
      const response = await fetchPost('/browser/launch');

      if (response && response.success) {
        const port = response.port;
        toast.success(t('layout.browser-launched', { port }), {
          id: 'launch-browser',
        });

        // Add launched browser to Electron CDP pool
        // Pool update will be pushed automatically via onCdpPoolChanged
        if (window.electronAPI?.addCdpBrowser) {
          await window.electronAPI.addCdpBrowser(
            port,
            false,
            `Launched Browser (${port})`
          );
        }
      } else {
        toast.error(response?.detail || t('layout.failed-to-launch-browser'), {
          id: 'launch-browser',
        });
      }
    } catch (error: any) {
      toast.error(error.message || t('layout.failed-to-launch-browser'), {
        id: 'launch-browser',
      });
    }
  };
  const handleConnectExistingBrowser = () => {
    setConnectPort('');
    setConnectError('');
    setShowConnectDialog(true);
  };

  const handleCheckAndConnect = async () => {
    const portNum = parseInt(connectPort, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setConnectError(t('layout.invalid-port'));
      return;
    }

    // Check if port is already in the pool
    if (cdpBrowsers.some((b) => b.port === portNum)) {
      setConnectError(t('layout.port-already-in-use'));
      return;
    }

    setConnectChecking(true);
    setConnectError('');

    try {
      // Probe the port to check if a CDP browser is listening
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`http://localhost:${portNum}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        setConnectError(t('layout.no-browser-on-port', { port: portNum }));
        return;
      }

      // Port is alive — add to CDP pool
      if (window.electronAPI?.addCdpBrowser) {
        await window.electronAPI.addCdpBrowser(
          portNum,
          true,
          `External Browser (${portNum})`
        );
      }

      toast.success(t('layout.connected-browser', { port: portNum }));
      setShowConnectDialog(false);
    } catch {
      setConnectError(t('layout.no-browser-on-port', { port: portNum }));
    } finally {
      setConnectChecking(false);
    }
  };

  const handleBrowserLogin = async () => {
    setLoginLoading(true);
    const currentCookieCount = cookieDomains.reduce(
      (sum, item) => sum + item.cookie_count,
      0
    );
    try {
      const response = await fetchPost('/browser/login');
      if (response) {
        toast.success(t('layout.browser-opened'));
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
                  setShowRestartDialog(true);
                } else if (newCookieCount < currentCookieCount) {
                  setShowRestartDialog(true);
                }
              }
            }
          } catch (error) {
            // Browser might be closed
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

  const handleDeleteAll = async () => {
    setDeletingAll(true);
    try {
      await fetchDelete('/browser/cookies');
      toast.success('Deleted all cookies');
      setCookieDomains([]);

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
      toast.error(t('layout.restart-not-available'));
    }
  };

  const handleConfirmRestart = () => {
    setShowRestartDialog(false);
    handleRestartApp();
  };

  return (
    <div className="m-auto flex h-auto max-w-[940px] flex-col">
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

      {/* Cookie Restart Confirm Dialog */}
      <AlertDialog
        isOpen={showCookieRestartDialog}
        onClose={() => setShowCookieRestartDialog(false)}
        onConfirm={() => {
          setShowCookieRestartDialog(false);
          handleRestartApp();
        }}
        title="Restart Required"
        message="Restart the application to enable your cookie domain changes."
        confirmText="Restart"
        cancelText={t('layout.cancel')}
        confirmVariant="information"
      />

      {/* Remove Browser Confirmation Dialog */}
      <AlertDialog
        isOpen={!!browserToRemove}
        onClose={() => setBrowserToRemove(null)}
        onConfirm={() => {
          if (browserToRemove) {
            handleRemoveBrowser(browserToRemove.id);
          }
        }}
        title={t('layout.remove-browser')}
        message={t('layout.remove-browser-confirm', {
          name: browserToRemove?.name || `Browser ${browserToRemove?.port}`,
          port: browserToRemove?.port,
        })}
        confirmText={t('layout.remove')}
        cancelText={t('layout.cancel')}
        confirmVariant="cuation"
      />

      {/* Connect Existing Browser Dialog */}
      {showConnectDialog && (
        <div className="bg-black/50 fixed inset-0 z-50 flex items-center justify-center">
          <div className="w-full max-w-md rounded-xl bg-surface-primary p-6 shadow-lg">
            <div className="text-body-base mb-2 font-bold text-text-heading">
              {t('layout.connect-existing-browser')}
            </div>
            <p className="mb-4 text-label-xs text-text-label">
              {t('layout.connect-existing-browser-description')}
            </p>
            <input
              type="text"
              value={connectPort}
              onChange={(e) => {
                setConnectPort(e.target.value);
                setConnectError('');
              }}
              placeholder={t('layout.enter-port-number')}
              className="w-full rounded-lg border border-border-disabled bg-surface-secondary px-4 py-2 text-body-sm text-text-body outline-none focus:border-border-focus"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCheckAndConnect();
              }}
            />
            {connectError && (
              <p className="mt-2 text-label-xs text-text-cuation">
                {connectError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConnectDialog(false)}
              >
                {t('layout.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleCheckAndConnect}
                disabled={connectChecking}
              >
                {connectChecking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                {t('layout.check-and-connect')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex h-auto w-full px-6">
        {/* Left Sidebar */}
        <div className="sticky top-20 flex h-full w-48 flex-shrink-0 flex-grow-0 flex-col self-start pr-6 pt-8">
          <VerticalNavigation
            items={[
              {
                value: 'connection',
                label: (
                  <span className="text-body-sm font-bold">
                    {t('layout.browser-connection')}
                  </span>
                ),
              },
              {
                value: 'cookies',
                label: (
                  <span className="text-body-sm font-bold">
                    {t('layout.cookies-management')}
                  </span>
                ),
              },
            ]}
            value={activeTab}
            onValueChange={setActiveTab}
            className="h-full min-h-0 w-full flex-1 gap-0"
            listClassName="w-full h-full overflow-y-auto"
            contentClassName="hidden"
          />
        </div>

        {/* Right Content */}
        <div className="flex h-auto w-full flex-1 flex-col pb-8 pt-8">
          {activeTab === 'connection' && (
            <div className="flex flex-col">
              <div className="text-heading-sm font-bold text-text-heading">
                {t('layout.cdp-browser-connection')}
              </div>
              {/* Action Buttons */}
              <div className="mt-4 flex items-center gap-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleOpenNewBrowser}
                >
                  <Plus className="h-4 w-4" />
                  {t('layout.open-new-browser')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnectExistingBrowser}
                >
                  <Link2 className="h-4 w-4 text-button-tertiery-text-default" />
                  {t('layout.connect-existing-browser')}
                </Button>
              </div>

              {/* CDP Browser Pool */}
              <div className="mt-6 flex flex-col gap-3">
                <div className="flex flex-row items-center justify-between">
                  <div className="flex flex-row items-center justify-start gap-2">
                    <div className="text-body-base font-bold text-text-body">
                      {t('layout.cdp-browser-pool')}
                    </div>
                  </div>
                </div>

                {cdpBrowsers.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {cdpBrowsers.map((browser) => (
                      <div
                        key={browser.id}
                        className="flex items-center justify-between rounded-xl border-solid border-border-disabled bg-surface-secondary px-4 py-2"
                      >
                        <div className="flex w-full flex-row items-center gap-2">
                          <div className="h-2 w-2 shrink-0 rounded-full bg-text-success" />
                          <div className="flex flex-col items-start justify-start">
                            <span className="text-body-sm font-bold text-text-body">
                              {browser.name || `Browser ${browser.port}`}
                            </span>
                            <span className="text-label-xs text-text-label">
                              {t('layout.port')} {browser.port}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setBrowserToRemove(browser)}
                          disabled={deletingBrowser === browser.id}
                          className="ml-3 flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4 text-text-cuation" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center px-4 py-8">
                    <Globe className="mb-4 h-12 w-12 text-icon-secondary opacity-50" />
                    <div className="text-body-base text-center font-bold text-text-label">
                      {t('layout.no-browsers-in-pool')}
                    </div>
                    <p className="text-center text-label-xs font-medium text-text-label">
                      {t('layout.add-browsers-hint')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'cookies' && (
            <div className="flex flex-col">
              <div className="text-heading-sm font-bold text-text-heading">
                {t('layout.browser-cookies-management')}
              </div>

              {/* Action Buttons */}
              <div className="mt-4 flex items-center gap-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleBrowserLogin}
                  disabled={loginLoading}
                >
                  <Cookie className="h-4 w-4" />
                  {loginLoading
                    ? t('layout.opening')
                    : t('layout.open-browser')}
                </Button>
              </div>

              {/* Cookie Domains */}
              <div className="mt-6 flex flex-col gap-3">
                <div className="flex flex-row items-center justify-between">
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
                      size="icon"
                      onClick={() => setShowCookieRestartDialog(true)}
                    >
                      <RefreshCw className="h-4 w-4 text-text-information" />
                    </Button>
                  </div>
                </div>

                {cookieDomains.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {groupDomainsByMain(cookieDomains).map((group, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between rounded-xl border-solid border-border-disabled bg-surface-secondary px-4 py-2"
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
          )}

          {/* Footer */}
          <div className="mt-auto pt-8 text-center text-label-xs text-text-label">
            {t('layout.for-more-info')}
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
