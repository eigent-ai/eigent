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

import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { Globe, Link2, Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface CdpBrowser {
  id: string;
  port: number;
  isExternal: boolean;
  name?: string;
  addedAt: number;
}

export default function CDP() {
  const { t } = useTranslation();
  const [cdpBrowsers, setCdpBrowsers] = useState<CdpBrowser[]>([]);
  const [deletingBrowser, setDeletingBrowser] = useState<string | null>(null);
  const [browserToRemove, setBrowserToRemove] = useState<CdpBrowser | null>(
    null
  );
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [connectPort, setConnectPort] = useState('');
  const [connectChecking, setConnectChecking] = useState(false);
  const [connectError, setConnectError] = useState('');

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

  useEffect(() => {
    loadCdpBrowsers();
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onCdpPoolChanged) return;
    const cleanup = window.electronAPI.onCdpPoolChanged(
      (browsers: CdpBrowser[]) => {
        setCdpBrowsers(browsers);
      }
    );
    return cleanup;
  }, []);

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
      toast.error(error?.message || t('layout.failed-to-remove-browser'));
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
      const result = await window.electronAPI?.launchCdpBrowser();
      if (result?.success) {
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
  };

  const handleConnectExistingBrowser = () => {
    setConnectPort('');
    setConnectError('');
    setShowConnectDialog(true);
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

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`http://localhost:${portNum}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      timeoutId = null;

      if (!response.ok) {
        setConnectError(t('layout.no-browser-on-port', { port: portNum }));
        return;
      }

      if (window.electronAPI?.addCdpBrowser) {
        const addResult = await window.electronAPI.addCdpBrowser(
          portNum,
          true,
          `External Browser (${portNum})`
        );
        if (!addResult?.success) {
          setConnectError(
            addResult?.error || t('layout.failed-to-add-browser')
          );
          return;
        }
      } else {
        setConnectError(t('layout.failed-to-add-browser'));
        return;
      }

      toast.success(t('layout.connected-browser', { port: portNum }));
      setShowConnectDialog(false);
    } catch {
      setConnectError(t('layout.no-browser-on-port', { port: portNum }));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setConnectChecking(false);
    }
  };

  return (
    <div className="m-auto flex h-auto w-full flex-1 flex-col">
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

      <div className="flex w-full items-center justify-between px-6 pb-6 pt-8">
        <div className="text-heading-sm font-bold text-text-heading">
          {t('layout.cdp-browser-connection')}
        </div>
      </div>

      <div className="flex flex-col gap-4 px-6">
        <div className="flex items-center gap-3">
          <Button variant="primary" size="sm" onClick={handleOpenNewBrowser}>
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

        <div className="flex flex-col gap-2">
          <div className="text-body-base font-bold text-text-body">
            {t('layout.cdp-browser-pool')}
          </div>

          {cdpBrowsers.length > 0 ? (
            <div className="flex flex-col gap-2">
              {cdpBrowsers.map((browser) => (
                <div
                  key={browser.id}
                  className="flex items-center justify-between rounded-xl border-solid border-border-disabled bg-surface-tertiary px-4 py-2"
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
              onChange={(event) => {
                setConnectPort(event.target.value);
                setConnectError('');
              }}
              placeholder={t('layout.enter-port-number')}
              className="w-full rounded-lg border border-border-disabled bg-surface-secondary px-4 py-2 text-body-sm text-text-body outline-none focus:border-border-focus"
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleCheckAndConnect();
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
    </div>
  );
}
