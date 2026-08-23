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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useHost } from '@/host';
import { Globe, Link2, Loader2, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { SettingsRow, SettingsRowGroup } from '../SettingsRowGroup';
import SettingsSectionLoading from '../SettingsSectionLoading';
import SettingsSectionPage from '../SettingsSectionPage';

interface CdpBrowser {
  id: string;
  port: number;
  isExternal: boolean;
  name?: string;
  addedAt: number;
}

export default function CDP() {
  const host = useHost();
  const electronAPI = host?.electronAPI;
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cdpBrowsers, setCdpBrowsers] = useState<CdpBrowser[]>([]);
  const [browsersLoading, setBrowsersLoading] = useState(true);
  const [browsersError, setBrowsersError] = useState<string | null>(null);
  const [deletingBrowser, setDeletingBrowser] = useState<string | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const [browserToRemove, setBrowserToRemove] = useState<CdpBrowser | null>(
    null
  );
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [connectPort, setConnectPort] = useState('');
  const [connectChecking, setConnectChecking] = useState(false);
  const [connectError, setConnectError] = useState('');
  const isDesktopMode = !!electronAPI?.getCdpBrowsers;
  const failedToLoadBrowsers = t('layout.failed-to-load-browsers');

  const loadCdpBrowsers = useCallback(async () => {
    setBrowsersLoading(true);
    setBrowsersError(null);
    try {
      if (electronAPI?.getCdpBrowsers) {
        const browsers = await electronAPI.getCdpBrowsers();
        setCdpBrowsers(browsers);
        return;
      }

      const browsers = await fetchGet('/browser/cdp/list');
      setCdpBrowsers(Array.isArray(browsers) ? browsers : []);
    } catch (error) {
      console.error('Failed to load CDP browsers:', error);
      setBrowsersError(
        error instanceof Error ? error.message : failedToLoadBrowsers
      );
    } finally {
      setBrowsersLoading(false);
    }
  }, [electronAPI, failedToLoadBrowsers]);

  useEffect(() => {
    void loadCdpBrowsers();
  }, [loadCdpBrowsers]);

  useEffect(() => {
    if (!electronAPI?.onCdpPoolChanged) return;
    const cleanup = electronAPI.onCdpPoolChanged((browsers: CdpBrowser[]) => {
      setCdpBrowsers(browsers);
    });
    return cleanup;
  }, [electronAPI]);

  const handleRemoveBrowser = async (browserId: string) => {
    setDeletingBrowser(browserId);
    try {
      if (electronAPI?.removeCdpBrowser && isDesktopMode) {
        const result = await electronAPI.removeCdpBrowser(browserId);
        if (result.success) {
          toast.success(t('layout.browser-removed'));
        } else {
          toast.error(result.error || t('layout.failed-to-remove-browser'));
        }
      } else if (browserToRemove) {
        const result = await fetchDelete(
          `/browser/cdp/${browserToRemove.port}`
        );
        if (result?.success) {
          toast.success(t('layout.browser-removed'));
          await loadCdpBrowsers();
        } else {
          toast.error(result?.error || t('layout.failed-to-remove-browser'));
        }
      }
    } catch (error: any) {
      toast.error(error?.message || t('layout.failed-to-remove-browser'));
    } finally {
      setDeletingBrowser(null);
      setBrowserToRemove(null);
    }
  };

  const handleOpenNewBrowser = useCallback(async () => {
    try {
      toast.loading(t('layout.launching-browser', { port: '...' }), {
        id: 'launch-browser',
      });
      const result = isDesktopMode
        ? await electronAPI?.launchCdpBrowser()
        : await fetchPost('/browser/cdp/launch');
      if (result?.success) {
        if (!isDesktopMode) {
          await loadCdpBrowsers();
        }
        toast.success(t('layout.browser-launched', { port: result.port }), {
          id: 'launch-browser',
        });
      } else {
        toast.error(result?.error || t('layout.failed-to-launch-browser'), {
          id: 'launch-browser',
        });
      }
    } catch (error: any) {
      toast.error(error?.message || t('layout.failed-to-launch-browser'), {
        id: 'launch-browser',
      });
    }
  }, [electronAPI, isDesktopMode, loadCdpBrowsers, t]);

  useEffect(() => {
    if (searchParams.get('browserAction') !== 'launch') return;
    const next = new URLSearchParams(searchParams);
    next.delete('browserAction');
    setSearchParams(next, { replace: true });
    void handleOpenNewBrowser();
  }, [searchParams, setSearchParams, handleOpenNewBrowser]);

  const handleConnectExistingBrowser = () => {
    setConnectPort('');
    setConnectError('');
    setShowConnectDialog(true);
  };

  const handleCloseAllBrowsers = async () => {
    if (cdpBrowsers.length === 0) return;
    setClosingAll(true);
    try {
      if (electronAPI?.removeCdpBrowser && isDesktopMode) {
        const results = await Promise.all(
          cdpBrowsers.map((browser) => electronAPI.removeCdpBrowser(browser.id))
        );
        const failed = results.find((result) => !result.success);
        if (failed) throw new Error(failed.error);
        setCdpBrowsers([]);
      } else {
        const results = await Promise.all(
          cdpBrowsers.map((browser) =>
            fetchDelete(`/browser/cdp/${browser.port}`)
          )
        );
        const failed = results.find((result) => !result?.success);
        if (failed) throw new Error(failed.error);
        await loadCdpBrowsers();
      }
      toast.success(
        t('layout.closed-all-browsers', {
          defaultValue: 'Closed all browsers',
        })
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('layout.failed-to-close-all-browsers', {
              defaultValue: 'Failed to close all browsers',
            })
      );
    } finally {
      setClosingAll(false);
    }
  };

  const handleCheckAndConnect = async () => {
    const portNum = parseInt(connectPort, 10);
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setConnectError(t('layout.invalid-port'));
      return;
    }

    if (cdpBrowsers.some((browser) => browser.port === portNum)) {
      setConnectError(t('layout.port-already-in-use'));
      return;
    }

    setConnectChecking(true);
    setConnectError('');

    try {
      if (electronAPI?.addCdpBrowser && isDesktopMode) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(
          `http://localhost:${portNum}/json/version`,
          {
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);

        if (!response.ok) {
          setConnectError(t('layout.no-browser-on-port', { port: portNum }));
          return;
        }

        const addResult = await electronAPI.addCdpBrowser(
          portNum,
          true,
          t('layout.external-browser-name', { port: portNum })
        );
        if (!addResult?.success) {
          setConnectError(
            addResult?.error || t('layout.failed-to-add-browser')
          );
          return;
        }
      } else {
        const connectResult = await fetchPost('/browser/cdp/connect', {
          port: portNum,
          name: t('layout.external-browser-name', { port: portNum }),
        });
        if (!connectResult?.success) {
          setConnectError(
            connectResult?.error || t('layout.failed-to-add-browser')
          );
          return;
        }
        await loadCdpBrowsers();
      }

      toast.success(t('layout.connected-browser', { port: portNum }));
      setShowConnectDialog(false);
    } catch {
      setConnectError(t('layout.no-browser-on-port', { port: portNum }));
    } finally {
      setConnectChecking(false);
    }
  };

  return (
    <SettingsSectionPage>
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
          name:
            browserToRemove?.name ||
            t('layout.browser-name', { port: browserToRemove?.port }),
          port: browserToRemove?.port,
        })}
        confirmText={t('layout.remove')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        confirmTone="error"
      />

      <SettingsRowGroup>
        <SettingsRow
          title={t('layout.browser', { defaultValue: 'Browser' })}
          description={t('layout.cdp-browser-pool-description')}
          action={
            <div className="flex flex-row gap-2">
              <Button
                variant="primary"
                size="sm"
                buttonContent="text"
                buttonRadius="full"
                tone="neutral"
                textWeight="semibold"
                onClick={handleOpenNewBrowser}
              >
                <Plus className="h-4 w-4" />
                {t('layout.open-new-browser')}
              </Button>
              <Button
                variant="outline"
                textWeight="semibold"
                buttonContent="text"
                buttonRadius="full"
                tone="neutral"
                size="sm"
                onClick={handleConnectExistingBrowser}
              >
                <Link2 />
                {t('layout.connect-existing-browser')}
              </Button>
            </div>
          }
        />

        <SettingsRow
          title={
            <span className="flex items-center gap-2">
              <span>
                {t('layout.browser-pool', { defaultValue: 'Browser Pool' })}
              </span>
              <span className="rounded-lg bg-ds-bg-information-subtle-default px-2 text-ds-text-base font-bold text-ds-text-information-strong-default">
                {cdpBrowsers.length}
              </span>
            </span>
          }
          description={t('layout.browser-pool-description', {
            defaultValue: 'Browsers available for task execution.',
          })}
          action={
            <Button
              variant="ghost"
              size="sm"
              buttonContent="text"
              buttonRadius="full"
              textWeight="semibold"
              onClick={handleCloseAllBrowsers}
              disabled={
                closingAll || browsersLoading || cdpBrowsers.length === 0
              }
              className="!text-ds-text-status-error-strong-default uppercase"
            >
              {closingAll
                ? t('layout.closing', { defaultValue: 'Closing' })
                : t('layout.close-all', { defaultValue: 'Close all' })}
            </Button>
          }
        >
          {browsersLoading && cdpBrowsers.length === 0 ? (
            <SettingsSectionLoading
              label={t('layout.loading-browser-connections')}
              rows={2}
              className="py-0"
            />
          ) : browsersError && cdpBrowsers.length === 0 ? (
            <div
              role="alert"
              className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center text-ds-text-base text-ds-text-error-strong-default"
            >
              <span>{browsersError}</span>
              <Button variant="outline" size="sm" onClick={loadCdpBrowsers}>
                {t('layout.retry', { defaultValue: 'Retry' })}
              </Button>
            </div>
          ) : cdpBrowsers.length > 0 ? (
            <div className="flex flex-col gap-2">
              {cdpBrowsers.map((browser) => (
                <div
                  key={browser.id}
                  className="flex items-center justify-between rounded-xl bg-ds-neutral-subtle-default px-4 py-2"
                >
                  <div className="flex w-full flex-row items-center gap-3">
                    <div className="h-2 w-2 shrink-0 rounded-full bg-ds-text-success-default-default" />
                    <div className="flex flex-col items-start justify-start">
                      <span className="text-ds-text-base font-bold text-ds-ink-default-default">
                        {browser.name ||
                          t('layout.browser-name', { port: browser.port })}
                      </span>
                      <span className="text-ds-text-meta text-ds-ink-muted-default">
                        {t('layout.port')} {browser.port}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    buttonContent="icon-only"
                    onClick={() => setBrowserToRemove(browser)}
                    disabled={deletingBrowser === browser.id}
                    className="ml-3 shrink-0"
                    aria-label={t('layout.remove-browser')}
                  >
                    <Trash2
                      className="h-4 w-4 text-ds-text-error-default-default"
                      aria-hidden
                    />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-8">
              <Globe className="mb-4 h-12 w-12 text-ds-ink-muted-default opacity-50" />
              <span className="text-center text-ds-text-base font-bold text-ds-ink-muted-default">
                {t('layout.no-browsers-in-pool')}
              </span>
              <span className="block text-center text-ds-text-meta font-medium text-ds-ink-muted-default">
                {t('layout.add-browsers-hint')}
              </span>
            </div>
          )}
        </SettingsRow>
      </SettingsRowGroup>

      <Dialog
        open={showConnectDialog}
        onOpenChange={(open) => {
          if (!open && connectChecking) return;
          setShowConnectDialog(open);
        }}
      >
        <DialogContent
          size="sm"
          showCloseButton={false}
          overlayVariant="dimmed"
          className="p-6"
          onEscapeKeyDown={(event) => {
            if (connectChecking) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (connectChecking) event.preventDefault();
          }}
        >
          <DialogTitle asChild>
            <span className="mb-2 block text-ds-text-base font-bold text-ds-ink-default-default">
              {t('layout.connect-existing-browser')}
            </span>
          </DialogTitle>
          <DialogDescription asChild>
            <span className="mb-4 block text-ds-text-meta text-ds-ink-muted-default">
              {t('layout.connect-existing-browser-description')}
            </span>
          </DialogDescription>
          <input
            type="text"
            value={connectPort}
            onChange={(event) => {
              setConnectPort(event.target.value);
              setConnectError('');
            }}
            placeholder={t('layout.enter-port-number')}
            className="w-full rounded-lg border border-x border-y border-ds-hairline-muted-disabled bg-ds-neutral-default-default px-4 py-2 text-ds-text-base text-ds-ink-default-default outline-none focus:border-ds-ring-focus"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCheckAndConnect();
            }}
          />
          {connectError && (
            <span className="mt-2 block text-ds-text-meta text-ds-text-status-error-strong-default">
              {connectError}
            </span>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowConnectDialog(false)}
              disabled={connectChecking}
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
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Link2 className="h-4 w-4" aria-hidden />
              )}
              {t('layout.check-and-connect')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsSectionPage>
  );
}
