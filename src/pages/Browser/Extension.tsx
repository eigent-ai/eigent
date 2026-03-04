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

import { getBaseURL } from '@/api/http';
import { Button } from '@/components/ui/button';
import { Loader2, Plug, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

type ProxyStatus = 'stopped' | 'waiting' | 'connected';

interface CdpBrowser {
  id: string;
  port: number;
  isExternal: boolean;
  isExtensionProxy?: boolean;
  name?: string;
  addedAt: number;
}

export default function Extension() {
  const { t } = useTranslation();
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus>('stopped');
  const [extensionProxy, setExtensionProxy] = useState<CdpBrowser | null>(null);

  // Load extension proxy entry from cdp pool
  const loadExtensionProxy = async () => {
    if (window.electronAPI?.getCdpBrowsers) {
      try {
        const browsers = await window.electronAPI.getCdpBrowsers();
        const proxy = browsers.find((b: CdpBrowser) => b.isExtensionProxy);
        setExtensionProxy(proxy || null);
      } catch (error) {
        console.error('Failed to load extension proxy:', error);
      }
    }
  };

  // Check backend proxy status on mount
  useEffect(() => {
    loadExtensionProxy();
    (async () => {
      try {
        const base = await getBaseURL();
        const resp = await fetch(`${base}/extension-proxy/status`);
        const data = await resp.json();
        setProxyStatus(data.status);
      } catch {
        // Backend not ready yet
      }
    })();
  }, []);

  // Listen for cdp pool changes
  useEffect(() => {
    if (!window.electronAPI?.onCdpPoolChanged) return;
    const cleanup = window.electronAPI.onCdpPoolChanged(
      (browsers: CdpBrowser[]) => {
        const proxy = browsers.find((b) => b.isExtensionProxy);
        setExtensionProxy(proxy || null);
      }
    );
    return cleanup;
  }, []);

  // Poll status when waiting for extension to connect
  useEffect(() => {
    if (proxyStatus !== 'waiting') return;
    const interval = setInterval(async () => {
      try {
        const base = await getBaseURL();
        const resp = await fetch(`${base}/extension-proxy/status`);
        const data = await resp.json();
        setProxyStatus(data.status);
      } catch {
        // ignore
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [proxyStatus]);

  const handleConnect = async () => {
    try {
      // 1. Start backend WebSocket server
      const base = await getBaseURL();
      const resp = await fetch(`${base}/extension-proxy/start`, {
        method: 'POST',
      });
      const data = await resp.json();
      if (!data.success) {
        toast.error('Failed to start extension proxy server');
        return;
      }
      setProxyStatus(data.status);

      // 2. Add to cdp pool so it flows to backend in chat payload
      if (window.electronAPI?.addCdpBrowser) {
        await window.electronAPI.addCdpBrowser(
          8765,
          true,
          'Extension Proxy',
          true
        );
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to start extension proxy');
    }
  };

  const handleDisconnect = async () => {
    try {
      // 1. Stop backend WebSocket server
      const base = await getBaseURL();
      await fetch(`${base}/extension-proxy/stop`, { method: 'POST' });
      setProxyStatus('stopped');

      // 2. Remove from cdp pool
      if (extensionProxy && window.electronAPI?.removeCdpBrowser) {
        await window.electronAPI.removeCdpBrowser(extensionProxy.id, false);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to stop extension proxy');
    }
  };

  return (
    <div className="m-auto flex h-auto w-full flex-1 flex-col">
      <div className="flex w-full items-center justify-between px-6 pb-6 pt-8">
        <div className="text-heading-sm font-bold text-text-heading">
          {t('layout.browser-plugins')}
        </div>
      </div>

      <div className="flex flex-col gap-4 px-6">
        <div className="flex flex-col gap-2">
          <div className="text-body-base font-bold text-text-body">
            Extension Proxy
          </div>
          <p className="text-label-xs text-text-label">
            Connect a Chrome extension to control browser tabs. The extension
            communicates via WebSocket on port 8765.
          </p>
        </div>

        {proxyStatus === 'stopped' && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleConnect}
            className="w-fit"
          >
            <Plug className="h-4 w-4" />
            Connect Extension
          </Button>
        )}

        {proxyStatus === 'waiting' && (
          <div className="flex items-center justify-between rounded-xl border-solid border-border-disabled bg-surface-tertiary px-4 py-3">
            <div className="flex w-full flex-row items-center gap-2">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-warning" />
              <div className="flex flex-col items-start justify-start">
                <span className="text-body-sm font-bold text-text-body">
                  Waiting for extension...
                </span>
                <span className="text-label-xs text-text-label">
                  Connect your Chrome extension to ws://localhost:8765
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDisconnect}
              className="ml-3 flex-shrink-0"
            >
              <Trash2 className="h-4 w-4 text-text-cuation" />
            </Button>
          </div>
        )}

        {proxyStatus === 'connected' && (
          <div className="flex items-center justify-between rounded-xl border-solid border-border-disabled bg-surface-tertiary px-4 py-3">
            <div className="flex w-full flex-row items-center gap-2">
              <div className="h-2 w-2 shrink-0 rounded-full bg-text-success" />
              <div className="flex flex-col items-start justify-start">
                <span className="text-body-sm font-bold text-text-body">
                  Extension Proxy
                </span>
                <span className="text-label-xs text-text-label">
                  Connected via ws://localhost:8765
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDisconnect}
              className="ml-3 flex-shrink-0"
            >
              <Trash2 className="h-4 w-4 text-text-cuation" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
