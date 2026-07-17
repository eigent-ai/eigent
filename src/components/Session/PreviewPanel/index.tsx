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

import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import { cn } from '@/lib/utils';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { previewTabIcon } from './tabKinds';
import { BrowserTab } from './tabs/browser/BrowserTab';
import { CanvasTab } from './tabs/CanvasTab';
import { ChooserTab } from './tabs/ChooserTab';
import { FileTab } from './tabs/FileTab';
import { ReviewTab } from './tabs/ReviewTab';
import { TerminalTab } from './tabs/TerminalTab';

// Tabs render at a comfortable default width and shrink evenly as more are
// added, down to a minimum that keeps the title/close affordance legible.
// Once every tab is at its minimum the tab list scrolls horizontally.
const TAB_DEFAULT_WIDTH = 176;
const TAB_MIN_WIDTH = 92;

export interface PreviewPanelProps {
  onJumpToContext?: (file: FileInfo | null) => void;
  /**
   * False while the display panel's open animation is still running. Browser
   * tabs hold their fixed-position webview guest parked until it settles so
   * the page doesn't pop in over the chat mid-animation.
   */
  displaySettled?: boolean;
}

/**
 * Unified preview panel: a tab strip plus a content router that dispatches to
 * one component per tab kind (chooser / browser / file / review / terminal /
 * canvas). Embedded browsers live in the always-mounted PreviewBrowserLayer;
 * this panel only renders their chrome via BrowserTab.
 */
export function PreviewPanel({
  onJumpToContext,
  displaySettled = true,
}: PreviewPanelProps) {
  const { t } = useTranslation();
  const host = useHost();
  const tabs = usePageTabStore((state) => getSessionPreviewSlice(state).tabs);
  const activeTabId = usePageTabStore(
    (state) => getSessionPreviewSlice(state).activeTabId
  );
  const addChooserPreviewTab = usePageTabStore(
    (state) => state.addChooserPreviewTab
  );
  const choosePreviewTabType = usePageTabStore(
    (state) => state.choosePreviewTabType
  );
  const selectSessionPreviewTab = usePageTabStore(
    (state) => state.selectSessionPreviewTab
  );
  const closeSessionPreviewTab = usePageTabStore(
    (state) => state.closeSessionPreviewTab
  );

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [activeTabId, tabs]
  );
  // Embedded browsing relies on the desktop host's <webview> tag; on the web
  // the panel still works but URLs open in a regular browser tab.
  const isDesktop = Boolean(host?.electronAPI);
  const tabListRef = useRef<HTMLDivElement>(null);
  const [tabOverflow, setTabOverflow] = useState({ start: false, end: false });

  const updateTabOverflow = useCallback(() => {
    const el = tabListRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setTabOverflow({
      start: scrollLeft > 1,
      end: scrollLeft + clientWidth < scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const el = tabListRef.current;
    if (!el) return;
    updateTabOverflow();
    const observer = new ResizeObserver(updateTabOverflow);
    observer.observe(el);
    el.addEventListener('scroll', updateTabOverflow, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', updateTabOverflow);
    };
  }, [updateTabOverflow, tabs.length]);

  if (!activeTab) return null;

  // Roving tabindex: only the selected tab is in the Tab order; Left/Right
  // (and Home/End) move both selection and focus along the strip.
  const handleTabListKeyDown = (event: React.KeyboardEvent) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab.id);
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = Math.max(0, currentIndex - 1);
        break;
      case 'ArrowRight':
        nextIndex = Math.min(tabs.length - 1, currentIndex + 1);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (nextIndex === currentIndex) return;
    selectSessionPreviewTab(tabs[nextIndex].id);
    tabListRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [nextIndex]?.focus();
  };

  const renderActiveContent = () => {
    switch (activeTab.type) {
      case 'chooser':
        return (
          <ChooserTab
            onChoose={(kind) => choosePreviewTabType(activeTab.id, kind)}
          />
        );
      case 'browser':
        // Keyed so each browser tab keeps its own address state.
        return (
          <BrowserTab
            key={activeTab.id}
            tab={activeTab}
            isDesktop={isDesktop}
            viewportSettled={displaySettled}
          />
        );
      case 'file':
        return <FileTab tab={activeTab} onJumpToContext={onJumpToContext} />;
      case 'review':
        return <ReviewTab />;
      case 'terminal':
        return <TerminalTab />;
      case 'canvas':
        return <CanvasTab key={activeTab.id} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden px-1 pb-2">
      <div className="flex h-[44px] shrink-0 items-center justify-start gap-1 px-1.5">
        <div className="relative flex min-w-0 items-center">
          <div
            ref={tabListRef}
            role="tablist"
            aria-label={t('layout.preview-tabs', {
              defaultValue: 'Preview tabs',
            })}
            onKeyDown={handleTabListKeyDown}
            className="scrollbar-hide flex h-7 w-full min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden"
          >
            {tabs.map((tab) => {
              const selected = tab.id === activeTab.id;
              const Icon = previewTabIcon(tab.type);
              return (
                <div
                  key={tab.id}
                  style={{
                    flex: `0 1 ${TAB_DEFAULT_WIDTH}px`,
                    minWidth: TAB_MIN_WIDTH,
                    maxWidth: TAB_DEFAULT_WIDTH,
                  }}
                  className={cn(
                    // Every tab uses the selected colors; unselected tabs are
                    // just dimmed (40% at rest, 80% on hover) so selection
                    // reads as full opacity rather than a color change.
                    'group relative h-7 rounded-lg bg-ds-bg-neutral-strong-default text-ds-text-neutral-default-default transition-opacity',
                    selected ? 'opacity-100' : 'opacity-40 hover:opacity-80'
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => selectSessionPreviewTab(tab.id)}
                    className="flex h-full w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent px-2 text-left text-inherit"
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
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
                      closeSessionPreviewTab(tab.id);
                    }}
                    className={cn(
                      'absolute inset-y-0 right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg border-0 px-1 text-inherit opacity-0 transition-opacity group-hover:opacity-100',
                      // Keyboard users can't hover — reveal on focus too.
                      'focus-visible:opacity-100 group-focus-within:opacity-100',
                      'bg-ds-bg-neutral-subtle-default hover:bg-ds-bg-neutral-muted-default'
                    )}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 w-6 backdrop-blur-[2px] transition-opacity duration-150',
              tabOverflow.start ? 'opacity-100' : 'opacity-0'
            )}
            style={{
              maskImage: 'linear-gradient(to right, black, transparent)',
              WebkitMaskImage: 'linear-gradient(to right, black, transparent)',
            }}
          />
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-y-0 right-0 w-8 backdrop-blur-[2px] transition-opacity duration-150',
              tabOverflow.end ? 'opacity-100' : 'opacity-0'
            )}
            style={{
              maskImage: 'linear-gradient(to left, black, transparent)',
              WebkitMaskImage: 'linear-gradient(to left, black, transparent)',
            }}
          />
        </div>
        <TooltipSimple
          content={t('layout.add-preview-tab', { defaultValue: 'New tab' })}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={addChooserPreviewTab}
            aria-label={t('layout.add-preview-tab', {
              defaultValue: 'New tab',
            })}
            className="shrink-0"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </Button>
        </TooltipSimple>
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border-solid border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-subtle-default">
        {renderActiveContent()}
      </div>
    </div>
  );
}

export default PreviewPanel;
