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

import { FilePreview } from '@/components/Folder/FilePreview';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import { normalizeBrowserUrl } from '@/lib/browserUrl';
import { cn } from '@/lib/utils';
import {
  type SessionBrowserNavigationState,
  type SessionBrowserTab,
  usePageTabStore,
} from '@/store/pageTabStore';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  FileText,
  Globe,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const BLANK_URL = 'about:blank?use=0';

function browserTitle(state: SessionBrowserNavigationState): string {
  const explicitTitle = state.title.trim();
  if (explicitTitle) return explicitTitle;
  if (!state.url || state.url.startsWith('about:')) return 'New tab';
  try {
    return new URL(state.url).hostname || 'New tab';
  } catch {
    return 'New tab';
  }
}

export interface PreviewPanelProps {
  onJumpToContext?: (file: FileInfo | null) => void;
}

export function PreviewPanel({ onJumpToContext }: PreviewPanelProps) {
  const { t } = useTranslation();
  const host = useHost();
  const tabs = usePageTabStore((state) => state.sessionPreviewTabs);
  const activeTabId = usePageTabStore(
    (state) => state.activeSessionPreviewTabId
  );
  const addBrowserPreviewTab = usePageTabStore(
    (state) => state.addBrowserPreviewTab
  );
  const addFilePreviewTab = usePageTabStore((state) => state.addFilePreviewTab);
  const selectSessionPreviewTab = usePageTabStore(
    (state) => state.selectSessionPreviewTab
  );
  const closeSessionPreviewTab = usePageTabStore(
    (state) => state.closeSessionPreviewTab
  );
  const updateBrowserPreviewTab = usePageTabStore(
    (state) => state.updateBrowserPreviewTab
  );

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [activeTabId, tabs]
  );
  const browserTabs = useMemo(
    () =>
      tabs.filter((tab): tab is SessionBrowserTab => tab.type === 'browser'),
    [tabs]
  );
  const browserWebviewIds = browserTabs.map((tab) => tab.webviewId).join('|');
  const activeBrowserTab = activeTab?.type === 'browser' ? activeTab : null;
  const activeBrowserWebviewId = activeBrowserTab?.webviewId ?? '';
  const isDesktop = Boolean(host?.electronAPI?.navigateWebview);
  const browserContainerRef = useRef<HTMLDivElement>(null);
  const activeBrowserUrl = activeBrowserTab?.url ?? '';
  const [addressInput, setAddressInput] = useState(activeBrowserUrl);
  const [addressError, setAddressError] = useState<string | null>(null);

  const syncBounds = useCallback(
    (webviewId: string) => {
      if (!isDesktop || !browserContainerRef.current) return;
      const rect = browserContainerRef.current.getBoundingClientRect();
      void host?.electronAPI?.changeViewSize?.(webviewId, {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    },
    [host, isDesktop]
  );

  const showBrowserTab = useCallback(
    async (tab: SessionBrowserTab) => {
      if (!isDesktop || !tab.url) return;
      await host?.electronAPI?.showWebview?.(tab.webviewId);
      syncBounds(tab.webviewId);
    },
    [host, isDesktop, syncBounds]
  );

  const navigateTo = useCallback(
    async (tab: SessionBrowserTab, rawUrl: string) => {
      const normalized = normalizeBrowserUrl(rawUrl);
      if (!normalized.ok) {
        setAddressError(normalized.error);
        return;
      }

      setAddressError(null);
      setAddressInput(normalized.url);
      updateBrowserPreviewTab(tab.id, { url: normalized.url });

      if (!isDesktop) {
        window.open(normalized.url, '_blank', 'noopener,noreferrer');
        return;
      }

      await host?.electronAPI?.createWebView?.(tab.webviewId, BLANK_URL);
      const result = await host?.electronAPI?.navigateWebview?.(
        tab.webviewId,
        normalized.url
      );
      if (result?.success === false) {
        setAddressError(result.error || 'Unable to open this URL');
        return;
      }
      await host?.electronAPI?.showWebview?.(tab.webviewId);
      syncBounds(tab.webviewId);
    },
    [host, isDesktop, syncBounds, updateBrowserPreviewTab]
  );

  const openExternal = useCallback((rawUrl: string) => {
    const normalized = normalizeBrowserUrl(rawUrl);
    if (!normalized.ok) {
      setAddressError(normalized.error);
      return;
    }
    setAddressError(null);
    window.open(normalized.url, '_blank', 'noopener,noreferrer');
  }, []);

  useEffect(() => {
    setAddressInput(activeBrowserUrl);
    setAddressError(null);
  }, [activeBrowserUrl, activeTab?.id]);

  useEffect(() => {
    if (!isDesktop) return;

    const state = usePageTabStore.getState();
    const currentActiveTab = state.sessionPreviewTabs.find(
      (tab) => tab.id === state.activeSessionPreviewTabId
    );
    const currentBrowserTabs = state.sessionPreviewTabs.filter(
      (tab): tab is SessionBrowserTab => tab.type === 'browser'
    );

    currentBrowserTabs.forEach((tab) => {
      if (tab.id !== currentActiveTab?.id) {
        void host?.electronAPI?.hideWebView?.(tab.webviewId);
      }
    });

    if (currentActiveTab?.type !== 'browser') return;

    let cancelled = false;
    const activate = async () => {
      const result = await host?.electronAPI?.createWebView?.(
        currentActiveTab.webviewId,
        BLANK_URL
      );
      if (cancelled || !currentActiveTab.url) return;
      if (result?.success) {
        await host?.electronAPI?.navigateWebview?.(
          currentActiveTab.webviewId,
          currentActiveTab.url
        );
      }
      if (!cancelled) await showBrowserTab(currentActiveTab);
    };
    void activate();

    return () => {
      cancelled = true;
      void host?.electronAPI?.hideWebView?.(currentActiveTab.webviewId);
    };
  }, [
    activeBrowserTab?.id,
    browserWebviewIds,
    host,
    isDesktop,
    showBrowserTab,
  ]);

  useEffect(() => {
    if (!isDesktop || !activeBrowserUrl || !activeBrowserWebviewId) return;
    const container = browserContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() =>
      syncBounds(activeBrowserWebviewId)
    );
    observer.observe(container);
    syncBounds(activeBrowserWebviewId);
    return () => observer.disconnect();
  }, [activeBrowserUrl, activeBrowserWebviewId, isDesktop, syncBounds]);

  useEffect(() => {
    if (!isDesktop) return;
    return host?.electronAPI?.onPreviewWebviewStateChanged?.(
      (webviewId: string, state: SessionBrowserNavigationState) => {
        const tab = usePageTabStore
          .getState()
          .sessionPreviewTabs.find(
            (candidate) =>
              candidate.type === 'browser' && candidate.webviewId === webviewId
          );
        if (!tab) return;
        const url = state.url.startsWith('about:') ? '' : state.url;
        updateBrowserPreviewTab(tab.id, {
          title: browserTitle(state),
          url,
          navigation: { ...state, url },
        });
      }
    );
  }, [host, isDesktop, updateBrowserPreviewTab]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (tab?.type === 'browser') {
        void host?.electronAPI?.webviewDestroy?.(tab.webviewId);
      }
      closeSessionPreviewTab(tabId);
    },
    [closeSessionPreviewTab, host, tabs]
  );

  if (!activeTab) return null;

  const nav = activeTab.type === 'browser' ? activeTab.navigation : undefined;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden px-1 pb-2">
      <div className="flex h-[44px] shrink-0 items-center justify-start gap-1 px-1">
        <div
          role="tablist"
          aria-label={t('layout.preview-tabs', {
            defaultValue: 'Preview tabs',
          })}
          className="scrollbar-hide flex h-7 min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden"
        >
          {tabs.map((tab) => {
            const selected = tab.id === activeTab.id;
            return (
              <div
                key={tab.id}
                className={cn(
                  'group relative h-7 w-fit max-w-[220px] shrink-0 rounded-lg',
                  selected
                    ? 'bg-ds-bg-neutral-strong-default text-ds-text-neutral-default-default'
                    : 'text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-default-default'
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectSessionPreviewTab(tab.id)}
                  className="flex h-full w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent px-2 text-left text-inherit"
                >
                  {tab.type === 'browser' ? (
                    <Globe className="h-4 w-4 shrink-0" aria-hidden />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  <span className="truncate text-sm font-medium">
                    {tab.title}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t('layout.close-preview-tab', {
                    defaultValue: 'Close tab',
                  })}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                  className={cn(
                    'absolute inset-y-0 right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg border-0 px-1 text-inherit opacity-0 transition-opacity group-hover:opacity-100',
                    selected
                      ? 'bg-ds-bg-neutral-subtle-default hover:bg-ds-bg-neutral-muted-default'
                      : 'bg-ds-bg-neutral-subtle-default hover:bg-ds-bg-neutral-muted-default'
                  )}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              aria-label={t('layout.add-preview-tab', {
                defaultValue: 'Add display tab',
              })}
              className="shrink-0"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6}>
            <DropdownMenuItem onSelect={addBrowserPreviewTab}>
              <Globe aria-hidden />
              {t('layout.add-browser-tab', {
                defaultValue: 'New browser',
              })}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={addFilePreviewTab}>
              <FileText aria-hidden />
              {t('layout.add-file-tab', { defaultValue: 'New file' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl bg-ds-bg-neutral-default-default">
        {activeTab.type === 'browser' ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex h-[44px] shrink-0 items-center gap-1.5 px-2">
              <TooltipSimple
                content={t('layout.browser-back', { defaultValue: 'Back' })}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  disabled={!isDesktop || !nav?.canGoBack}
                  onClick={() =>
                    host?.electronAPI?.goBackWebview?.(activeTab.webviewId)
                  }
                  aria-label={t('layout.browser-back', {
                    defaultValue: 'Back',
                  })}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </Button>
              </TooltipSimple>
              <TooltipSimple
                content={t('layout.browser-forward', {
                  defaultValue: 'Forward',
                })}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  disabled={!isDesktop || !nav?.canGoForward}
                  onClick={() =>
                    host?.electronAPI?.goForwardWebview?.(activeTab.webviewId)
                  }
                  aria-label={t('layout.browser-forward', {
                    defaultValue: 'Forward',
                  })}
                >
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </TooltipSimple>
              <TooltipSimple
                content={t('layout.browser-reload', { defaultValue: 'Reload' })}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  disabled={!isDesktop || !activeTab.url}
                  onClick={() =>
                    host?.electronAPI?.reloadWebview?.(activeTab.webviewId)
                  }
                  aria-label={t('layout.browser-reload', {
                    defaultValue: 'Reload',
                  })}
                >
                  <RefreshCw
                    className={cn('h-4 w-4', nav?.isLoading && 'animate-spin')}
                    aria-hidden
                  />
                </Button>
              </TooltipSimple>
              <form
                className="flex min-w-0 flex-1 items-center"
                onSubmit={(event) => {
                  event.preventDefault();
                  void navigateTo(activeTab, addressInput);
                }}
              >
                <input
                  type="text"
                  value={addressInput}
                  onChange={(event) => {
                    setAddressInput(event.target.value);
                    if (addressError) setAddressError(null);
                  }}
                  placeholder={t('layout.browser-url-placeholder', {
                    defaultValue: 'Enter a URL',
                  })}
                  aria-label={t('layout.browser-url-placeholder', {
                    defaultValue: 'Enter a URL',
                  })}
                  aria-invalid={Boolean(addressError)}
                  className={cn(
                    'placeholder:text-input-label-default/10 h-[28px] w-full min-w-0 rounded-xl border-none bg-ds-bg-neutral-subtle-default px-3 text-body-sm text-ds-text-neutral-default-default outline-none transition-colors',
                    'hover:bg-ds-bg-neutral-subtle-default hover:ring-1 hover:ring-ds-ring-neutral-strong-default hover:ring-offset-0',
                    'focus:bg-ds-bg-neutral-subtle-default focus:ring-1 focus:ring-ds-ring-brand-default-focus focus:ring-offset-0',
                    addressError
                      ? 'border-ds-border-status-error-default-default'
                      : 'border-ds-border-neutral-default-default'
                  )}
                />
              </form>
              <TooltipSimple
                content={t('layout.browser-open-external', {
                  defaultValue: 'Open externally',
                })}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  disabled={!addressInput}
                  onClick={() => openExternal(addressInput)}
                  aria-label={t('layout.browser-open-external', {
                    defaultValue: 'Open externally',
                  })}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </Button>
              </TooltipSimple>
            </div>
            {addressError ? (
              <p className="text-ds-text-danger-default-default shrink-0 px-3 py-1 text-xs">
                {addressError}
              </p>
            ) : null}
            <div
              ref={browserContainerRef}
              className="relative min-h-0 flex-1 overflow-hidden bg-ds-bg-neutral-strong-default"
            >
              {!activeTab.url ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ds-text-neutral-muted-default">
                  {t('layout.browser-blank', {
                    defaultValue: 'Enter a URL to start browsing.',
                  })}
                </div>
              ) : !isDesktop ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ds-text-neutral-muted-default">
                  {t('layout.browser-desktop-only', {
                    defaultValue:
                      'Embedded browsing is available in the desktop app. This URL opened in your system browser.',
                  })}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <FilePreview
            file={activeTab.file}
            embedded
            surfaceClassName="bg-ds-bg-neutral-default-default"
            onJumpToContext={onJumpToContext}
          />
        )}
      </div>
    </div>
  );
}

export default PreviewPanel;
