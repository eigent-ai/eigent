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
import { Input } from '@/components/ui/input';
import {
  CheckCircle2,
  Cookie,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
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

interface CdpPortStatus {
  checking: boolean;
  available: boolean | null;
  error?: string;
  data?: any;
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
  const [loginLoading, setLoginLoading] = useState(false);
  const [cookiesLoading, setCookiesLoading] = useState(false);
  const [cookieDomains, setCookieDomains] = useState<CookieDomain[]>([]);
  const [deletingDomain, setDeletingDomain] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // CDP port configuration
  const [cdpPort, setCdpPort] = useState<number>(9223);
  const [customPort, setCustomPort] = useState<string>('9223');
  const [portStatus, setPortStatus] = useState<CdpPortStatus>({
    checking: false,
    available: null,
  });

  // Dialog states
  const [showUseExistingDialog, setShowUseExistingDialog] = useState(false);
  const [showLaunchNewDialog, setShowLaunchNewDialog] = useState(false);
  const [pendingPort, setPendingPort] = useState<number | null>(null);

  // CDP Browser Pool
  const [cdpBrowsers, setCdpBrowsers] = useState<CdpBrowser[]>([]);
  const [deletingBrowser, setDeletingBrowser] = useState<string | null>(null);
  const [runningPorts, setRunningPorts] = useState<number[]>([]);

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

        // Also load running browser ports
        if (window.electronAPI?.getRunningBrowserPorts) {
          const ports = await window.electronAPI.getRunningBrowserPorts();
          setRunningPorts(ports);
        }
      } catch (error) {
        console.error('Failed to load CDP browsers:', error);
      }
    }
  };

  // Periodically refresh running browser ports
  useEffect(() => {
    const interval = setInterval(async () => {
      if (window.electronAPI?.getRunningBrowserPorts) {
        try {
          const ports = await window.electronAPI.getRunningBrowserPorts();
          setRunningPorts(ports);
        } catch (error) {
          console.error('Failed to refresh running ports:', error);
        }
      }
    }, 3000); // Refresh every 3 seconds

    return () => clearInterval(interval);
  }, []);

  const handleCheckPort = async () => {
    const portNumber = parseInt(customPort);

    if (isNaN(portNumber) || portNumber < 1 || portNumber > 65535) {
      toast.error(t('layout.invalid-port'));
      return;
    }

    setPortStatus({ checking: true, available: null });

    try {
      if (!window.electronAPI?.checkCdpPort) {
        toast.error(t('layout.cdp-port-check-not-available'));
        setPortStatus({
          checking: false,
          available: false,
          error: 'Not available',
        });
        return;
      }

      const result = await window.electronAPI.checkCdpPort(portNumber);

      if (result.available) {
        setPortStatus({
          checking: false,
          available: true,
          data: result.data,
        });
        // Browser exists, ask if user wants to use it
        setPendingPort(portNumber);
        setShowUseExistingDialog(true);
      } else {
        setPortStatus({
          checking: false,
          available: false,
          error: result.error,
        });
        // No browser on this port, ask if user wants to launch one
        setPendingPort(portNumber);
        setShowLaunchNewDialog(true);
      }
    } catch (error: any) {
      setPortStatus({
        checking: false,
        available: false,
        error: error.message,
      });
      toast.error(error.message || t('layout.failed-to-check-port'));
    }
  };

  const handleUseExistingBrowser = async () => {
    setShowUseExistingDialog(false);
    if (pendingPort) {
      try {
        if (window.electronAPI?.addCdpBrowser) {
          const result = await window.electronAPI.addCdpBrowser(
            pendingPort,
            true,
            `External Browser (${pendingPort})`
          );
          if (result.success) {
            toast.success(
              t('layout.added-browser-to-pool', { port: pendingPort })
            );
            await loadCdpBrowsers();
          } else {
            toast.error(result.error || t('layout.failed-to-add-browser'));
          }
        }
      } catch (error: any) {
        toast.error(error.message || t('layout.failed-to-add-browser'));
      }
    }
    setPendingPort(null);
  };

  const handleLaunchNewBrowser = async () => {
    setShowLaunchNewDialog(false);

    if (!pendingPort) {
      return;
    }

    const port = pendingPort;
    setPendingPort(null);

    try {
      if (!window.electronAPI?.launchCdpBrowser) {
        toast.error(t('layout.launch-not-available'));
        return;
      }

      toast.loading(t('layout.launching-browser', { port }), {
        id: 'launch-browser',
      });

      const result = await window.electronAPI.launchCdpBrowser(port);

      if (result.success) {
        toast.success(t('layout.browser-launched', { port }), {
          id: 'launch-browser',
        });

        // Add launched browser to pool
        if (window.electronAPI?.addCdpBrowser) {
          const addResult = await window.electronAPI.addCdpBrowser(
            port,
            false,
            `Launched Browser (${port})`
          );
          if (addResult.success) {
            await loadCdpBrowsers();
          } else {
            toast.error(addResult.error || t('layout.failed-to-add-browser'));
          }
        }

        // Update port status
        setPortStatus({
          checking: false,
          available: true,
          data: result.data,
        });
      } else {
        toast.error(result.error || t('layout.failed-to-launch-browser'), {
          id: 'launch-browser',
        });
      }
    } catch (error: any) {
      toast.error(error.message || t('layout.failed-to-launch-browser'), {
        id: 'launch-browser',
      });
    }
  };

  const handleRemoveBrowser = async (browserId: string) => {
    setDeletingBrowser(browserId);
    try {
      if (window.electronAPI?.removeCdpBrowser) {
        const result = await window.electronAPI.removeCdpBrowser(browserId);
        if (result.success) {
          toast.success(t('layout.browser-removed'));
          await loadCdpBrowsers();
        } else {
          toast.error(result.error || t('layout.failed-to-remove-browser'));
        }
      }
    } catch (error: any) {
      toast.error(error.message || t('layout.failed-to-remove-browser'));
    } finally {
      setDeletingBrowser(null);
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
      toast.error(t('layout.restart-not-available'));
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

      {/* Use Existing Browser Dialog */}
      <AlertDialog
        isOpen={showUseExistingDialog}
        onClose={() => {
          setShowUseExistingDialog(false);
          setPendingPort(null);
        }}
        onConfirm={handleUseExistingBrowser}
        title={t('layout.browser-found')}
        message={t('layout.browser-found-description', { port: pendingPort })}
        confirmText={t('layout.yes-use-browser')}
        cancelText={t('layout.cancel')}
        confirmVariant="information"
      />

      {/* Launch New Browser Dialog */}
      <AlertDialog
        isOpen={showLaunchNewDialog}
        onClose={() => {
          setShowLaunchNewDialog(false);
          setPendingPort(null);
        }}
        onConfirm={handleLaunchNewBrowser}
        title={t('layout.no-browser-found')}
        message={t('layout.no-browser-found-description', {
          port: pendingPort,
        })}
        confirmText={t('layout.yes-launch-browser')}
        cancelText={t('layout.cancel')}
        confirmVariant="information"
      />

      {/* Header Section */}
      <div className="flex w-full border-x-0 border-t-0 border-solid border-border-disabled">
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
        <div className="mx-auto flex min-h-[calc(100vh-86px)] w-full max-w-[900px] flex-col items-start justify-center px-6 py-8">
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

            {/* CDP Port Configuration Section */}
            <div className="mt-3 flex w-full max-w-[600px] flex-col gap-3 border-[0.5px] border-x-0 border-b-0 border-solid border-border-secondary pt-3">
              <div className="flex flex-row items-center justify-between py-2">
                <div className="flex flex-col items-start">
                  <div className="text-body-base font-bold text-text-body">
                    {t('layout.cdp-browser-connection')}
                  </div>
                  <p className="mt-1 text-label-xs text-text-label">
                    {t('layout.cdp-browser-connection-description')}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-xl bg-surface-tertiary px-4 py-3">
                <div className="flex flex-col gap-2">
                  <div className="text-label-sm font-medium text-text-body">
                    {t('layout.current-port')}{' '}
                    <span className="font-bold text-text-information">
                      {cdpPort}
                    </span>
                  </div>
                  <p className="text-label-xs text-text-label">
                    {t('layout.cdp-port-check-description')}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder={t('layout.port-placeholder')}
                    value={customPort}
                    onChange={(e) => setCustomPort(e.target.value)}
                    className="flex-1"
                    min={1}
                    max={65535}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleCheckPort}
                    disabled={portStatus.checking}
                    className="min-w-[100px]"
                  >
                    {portStatus.checking ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('layout.checking')}
                      </>
                    ) : (
                      t('layout.check-port')
                    )}
                  </Button>
                </div>

                {portStatus.available !== null && (
                  <div
                    className={`flex items-start gap-2 rounded-lg p-3 ${
                      portStatus.available
                        ? 'bg-tag-fill-success text-text-success'
                        : 'bg-tag-fill-error text-text-cuation'
                    }`}
                  >
                    {portStatus.available ? (
                      <>
                        <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
                        <div className="flex flex-col gap-1">
                          <div className="text-label-sm font-bold">
                            {t('layout.browser-available')}
                          </div>
                          {portStatus.data && (
                            <div className="text-label-xs opacity-90">
                              {portStatus.data['Browser']} -{' '}
                              {portStatus.data['User-Agent']?.split(' ')[0]}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                        <div className="flex flex-col gap-1">
                          <div className="text-label-sm font-bold">
                            {t('layout.browser-not-available')}
                          </div>
                          <div className="text-label-xs opacity-90">
                            {portStatus.error}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* CDP Browser Pool Section */}
            <div className="mt-3 flex w-full max-w-[600px] flex-col gap-3 border-[0.5px] border-x-0 border-b-0 border-solid border-border-secondary pt-3">
              <div className="flex flex-row items-center justify-between py-2">
                <div className="flex flex-col items-start">
                  <div className="flex items-center gap-2">
                    <div className="text-body-base font-bold text-text-body">
                      {t('layout.cdp-browser-pool')}
                    </div>
                    <span className="rounded bg-tag-fill-info px-2 py-0.5 text-label-xs text-text-information">
                      {runningPorts.length} / {cdpBrowsers.length}{' '}
                      {t('layout.running')}
                    </span>
                  </div>
                  <p className="mt-1 text-label-xs text-text-label">
                    {t('layout.cdp-browser-pool-description')}
                  </p>
                </div>
              </div>

              {cdpBrowsers.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {cdpBrowsers.map((browser) => (
                    <div
                      key={browser.id}
                      className="flex items-center justify-between rounded-xl border-solid border-border-disabled bg-surface-tertiary px-4 py-3"
                    >
                      <div className="flex w-full flex-col items-start justify-start">
                        <div className="flex items-center gap-2">
                          <span className="text-body-sm font-bold text-text-body">
                            {browser.name || `Browser ${browser.port}`}
                          </span>
                          <span
                            className={`rounded px-2 py-0.5 text-label-xs ${
                              browser.isExternal
                                ? 'bg-tag-fill-info text-text-information'
                                : 'bg-tag-fill-success text-text-success'
                            }`}
                          >
                            {browser.isExternal
                              ? t('layout.external')
                              : t('layout.launched')}
                          </span>
                          {/* Running status indicator */}
                          {runningPorts.includes(browser.port) ? (
                            <span className="flex items-center gap-1 rounded bg-tag-fill-success px-2 py-0.5 text-label-xs text-text-success">
                              <span className="h-2 w-2 animate-pulse rounded-full bg-text-success"></span>
                              {t('layout.running')}
                            </span>
                          ) : (
                            !browser.isExternal && (
                              <span className="bg-tag-fill-error flex items-center gap-1 rounded px-2 py-0.5 text-label-xs text-text-cuation">
                                <span className="h-2 w-2 rounded-full bg-text-cuation"></span>
                                {t('layout.stopped')}
                              </span>
                            )
                          )}
                        </div>
                        <span className="mt-1 text-label-xs text-text-label">
                          {t('layout.port')} {browser.port}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveBrowser(browser.id)}
                        disabled={deletingBrowser === browser.id}
                        className="ml-3 flex-shrink-0"
                      >
                        <Trash2 className="h-4 w-4 text-text-cuation" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl bg-surface-tertiary px-4 py-8">
                  <Globe className="mb-4 h-12 w-12 text-icon-secondary opacity-50" />
                  <div className="text-body-base text-center font-bold text-text-label">
                    {t('layout.no-browsers-in-pool')}
                  </div>
                  <p className="mt-1 text-center text-label-xs font-medium text-text-label">
                    {t('layout.add-browsers-hint')}
                  </p>
                </div>
              )}
            </div>

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
