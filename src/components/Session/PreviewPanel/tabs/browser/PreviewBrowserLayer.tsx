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

import { useHost } from '@/host';
import {
  type PreviewBrowserViewport,
  type SessionBrowserNavigationState,
  type SessionBrowserTab,
  usePageTabStore,
} from '@/store/pageTabStore';
import { useEffect, useRef, useState } from 'react';
import {
  type PreviewWebviewElement,
  registerPreviewWebview,
  unregisterPreviewWebview,
} from './webviewRegistry';

/**
 * Hosts the preview panel's embedded browsers as Electron `<webview>` tags.
 *
 * Why a separate, always-mounted layer instead of rendering inside the panel:
 * - `<webview>` is a DOM element, so dropdowns/dialogs overlay it naturally
 *   (unlike a native WebContentsView, which paints above the whole document).
 * - A `<webview>` reloads whenever it is detached or reparented. Keeping the
 *   elements here — positioned over the panel via `previewBrowserViewport`,
 *   parked offscreen when not visible — preserves each guest's page state and
 *   full back/forward history across panel close, tab hops, and project
 *   switches for the lifetime of the workspace page.
 *
 * Mount once (in the workspace page). Renders nothing on the web host.
 */

/** Above page content, below portaled overlays (menus z-50, tooltips z-100). */
const GUEST_Z_INDEX = 30;
/** Matches the preview panel's rounded-xl browser container. */
const GUEST_RADIUS = 12;
/** Guest fade when (un)covering its viewport — softens show/park hops. */
const GUEST_FADE_MS = 160;
/**
 * Guests of projects that have been out of scope this long are destroyed to
 * reclaim their renderer processes. The tab's URL is persisted, so returning
 * to an evicted project simply reloads its pages (history is lost — the price
 * of not keeping every visited project's Chromium processes alive forever).
 */
const IDLE_PROJECT_EVICT_MS = 10 * 60_000;
const EVICT_SWEEP_INTERVAL_MS = 60_000;

const PARKED_STYLE: React.CSSProperties = {
  position: 'fixed',
  left: -10_000,
  top: 0,
  width: 1024,
  height: 640,
  visibility: 'hidden',
  pointerEvents: 'none',
};

function visibleStyle(
  viewport: PreviewBrowserViewport,
  shown: boolean
): React.CSSProperties {
  return {
    position: 'fixed',
    left: viewport.x,
    top: viewport.y,
    width: viewport.width,
    height: viewport.height,
    zIndex: GUEST_Z_INDEX,
    borderRadius: GUEST_RADIUS,
    overflow: 'hidden',
    opacity: shown ? 1 : 0,
    transition: `opacity ${GUEST_FADE_MS}ms ease`,
  };
}

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

const GUEST_EVENTS = [
  'did-navigate',
  'did-navigate-in-page',
  'did-start-loading',
  'did-stop-loading',
  'page-title-updated',
  'dom-ready',
] as const;

interface PreviewGuestProps {
  projectId: string;
  tab: SessionBrowserTab;
  visible: boolean;
  viewport: PreviewBrowserViewport | null;
}

function PreviewGuest({
  projectId,
  tab,
  visible,
  viewport,
}: PreviewGuestProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The guest reloads if its src attribute changes, so freeze the mount-time
  // URL; later navigation happens on the element (loadURL / link clicks) and
  // flows back into the store through the events below.
  const initialUrlRef = useRef(tab.url);
  const tabIdRef = useRef(tab.id);
  useEffect(() => {
    tabIdRef.current = tab.id;
  }, [tab.id]);

  // Show/park with a short opacity fade instead of an instant hop:
  // 'parked' → offscreen, 'faded' → over the viewport at opacity 0,
  // 'shown' → opacity 1. `lastViewport` remembers the rect the guest was
  // last shown at so the fade-out happens in place even after the panel
  // stops publishing a viewport (tab switch / project switch unmounts the
  // publisher in the same commit that hides the guest).
  const showing = visible && viewport !== null;
  const [lastViewport, setLastViewport] =
    useState<PreviewBrowserViewport | null>(null);
  useEffect(() => {
    if (viewport) setLastViewport(viewport);
  }, [viewport]);
  const [phase, setPhase] = useState<'parked' | 'faded' | 'shown'>('parked');
  useEffect(() => {
    if (showing) {
      setPhase('faded');
      // Double rAF so the opacity-0 frame commits before the fade-in starts.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setPhase('shown'));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setPhase((current) => (current === 'parked' ? 'parked' : 'faded'));
    const timer = window.setTimeout(() => setPhase('parked'), GUEST_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [showing]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !initialUrlRef.current) return;

    const element = document.createElement('webview') as PreviewWebviewElement;
    element.setAttribute('src', initialUrlRef.current);
    element.setAttribute('partition', 'persist:session-preview');
    // Popups are redirected into the same guest by the main process
    // (did-attach-webview → setWindowOpenHandler), so target=_blank links work.
    element.setAttribute('allowpopups', 'true');
    element.style.display = 'flex';
    element.style.width = '100%';
    element.style.height = '100%';

    const notify = () => {
      // Guest methods throw until the webview is attached; treat as no state.
      let state: SessionBrowserNavigationState;
      try {
        state = {
          url: element.getURL?.() ?? '',
          title: element.getTitle?.() ?? '',
          isLoading: element.isLoading?.() ?? false,
          canGoBack: element.canGoBack?.() ?? false,
          canGoForward: element.canGoForward?.() ?? false,
        };
      } catch {
        return;
      }
      const url = state.url.startsWith('about:') ? '' : state.url;
      usePageTabStore
        .getState()
        .updateBrowserPreviewTabIn(projectId, tabIdRef.current, {
          title: browserTitle(state),
          navigation: { ...state, url },
          // Guests mount only while the tab has a URL, so never write an
          // empty one back (early events can fire before a location exists).
          ...(url ? { url } : {}),
        });
    };

    GUEST_EVENTS.forEach((event) => element.addEventListener(event, notify));
    container.appendChild(element);
    registerPreviewWebview(tab.webviewId, element);

    return () => {
      GUEST_EVENTS.forEach((event) =>
        element.removeEventListener(event, notify)
      );
      unregisterPreviewWebview(tab.webviewId);
      element.remove();
    };
  }, [projectId, tab.webviewId]);

  const rect = viewport ?? lastViewport;
  return (
    <div
      ref={containerRef}
      data-preview-webview-id={tab.webviewId}
      style={
        phase === 'parked' || !rect
          ? PARKED_STYLE
          : visibleStyle(rect, phase === 'shown')
      }
    />
  );
}

export function PreviewBrowserLayer() {
  const host = useHost();
  const byProject = usePageTabStore((s) => s.sessionPreviewByProject);
  const scopeProjectId = usePageTabStore((s) => s.sessionPreviewProjectId);
  const viewport = usePageTabStore((s) => s.previewBrowserViewport);

  // Persisted slices may reference many projects; only mount guests for
  // projects the user has actually visited this run so startup stays light.
  const [activatedProjects, setActivatedProjects] = useState<Set<string>>(
    () => new Set()
  );
  useEffect(() => {
    if (!scopeProjectId) return;
    setActivatedProjects((current) => {
      if (current.has(scopeProjectId)) return current;
      const next = new Set(current);
      next.add(scopeProjectId);
      return next;
    });
  }, [scopeProjectId]);

  // Each guest is a full renderer process, so don't keep every visited
  // project's guests alive forever: track when a project leaves scope and
  // deactivate it (unmounting its guests) once it has idled long enough.
  const idleSinceRef = useRef(new Map<string, number>());
  useEffect(() => {
    if (!scopeProjectId) return;
    const idleSince = idleSinceRef.current;
    idleSince.delete(scopeProjectId);
    return () => {
      idleSince.set(scopeProjectId, Date.now());
    };
  }, [scopeProjectId]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setActivatedProjects((current) => {
        let next: Set<string> | null = null;
        for (const projectId of current) {
          const idleSince = idleSinceRef.current.get(projectId);
          if (
            idleSince === undefined ||
            Date.now() - idleSince < IDLE_PROJECT_EVICT_MS
          ) {
            continue;
          }
          next ??= new Set(current);
          next.delete(projectId);
          idleSinceRef.current.delete(projectId);
        }
        return next ?? current;
      });
    }, EVICT_SWEEP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Embedded browsing needs the desktop host's <webview> tag.
  if (!host?.electronAPI) return null;

  const guests: React.ReactNode[] = [];
  for (const [projectId, slice] of Object.entries(byProject)) {
    if (!activatedProjects.has(projectId)) continue;
    for (const tab of slice.tabs) {
      if (tab.type !== 'browser' || !tab.url) continue;
      const visible =
        projectId === scopeProjectId &&
        slice.open &&
        slice.activeTabId === tab.id;
      guests.push(
        <PreviewGuest
          key={tab.webviewId}
          projectId={projectId}
          tab={tab}
          visible={visible}
          viewport={viewport}
        />
      );
    }
  }

  return <>{guests}</>;
}

export default PreviewBrowserLayer;
