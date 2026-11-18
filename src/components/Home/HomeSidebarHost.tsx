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

import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// The router loads this file at startup, before the page chunks.
const HomeSidebar = lazy(() => import('@/components/Home/HomeSidebar'));

const HomeSidebarContext = createContext<{
  element: HTMLElement;
  workspaceOnScreen: boolean;
} | null>(null);

/**
 * Keeps one Home sidebar alive while Home's pages change. `/` and `/home` each
 * build their own page shell, so a sidebar inside either would be rebuilt on
 * every move between them. This one renders into a detached element, and
 * whichever page is on screen places that element in its shell.
 */
export function HomeSidebarHost({
  enabled,
  workspaceOnScreen,
  children,
}: {
  enabled: boolean;
  workspaceOnScreen: boolean;
  children: ReactNode;
}) {
  const [element] = useState(() => {
    const host = document.createElement('div');
    host.className = 'h-full min-h-0 w-full';
    return host;
  });
  const value = useMemo(
    () => (enabled ? { element, workspaceOnScreen } : null),
    [element, enabled, workspaceOnScreen]
  );

  return (
    <HomeSidebarContext.Provider value={value}>
      {enabled
        ? createPortal(
            <Suspense fallback={null}>
              <HomeSidebar />
            </Suspense>,
            element
          )
        : null}
      {children}
    </HomeSidebarContext.Provider>
  );
}

/**
 * Where a page shows Home's sidebar. The Workspace page stays mounted while
 * hidden, so it passes `workspace` to leave the sidebar to the page on screen.
 * `children` is the sidebar to show outside a host.
 */
export function HomeSidebarSlot({
  workspace = false,
  children,
}: {
  workspace?: boolean;
  children: ReactNode;
}) {
  const host = useContext(HomeSidebarContext);
  const slotRef = useRef<HTMLDivElement>(null);
  const element = host?.element;
  const active = !workspace || Boolean(host?.workspaceOnScreen);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot || !element || !active) return;
    slot.appendChild(element);
    return () => {
      // The next page may already have taken it.
      if (element.parentNode === slot) slot.removeChild(element);
    };
  }, [active, element]);

  if (!host) return <>{children}</>;
  return <div ref={slotRef} className="h-full min-h-0 w-full" />;
}
