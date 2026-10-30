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

import { isSettingsRoutePath, SHELL_BACK_STATE_KEY } from '@/lib/shellRoutes';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

interface WorkspaceSettingsRouteLayoutProps {
  workspace: ReactNode;
}

/**
 * Settings is a full-page surface, but opening it must not destroy transient
 * workspace state. Keep the workspace subtree mounted across the Workspace ↔
 * Home / Settings transition so drafts, forms, and live preview webviews
 * survive while the combined management page is open.
 */
export default function WorkspaceSettingsRouteLayout({
  workspace,
}: WorkspaceSettingsRouteLayoutProps) {
  const location = useLocation();
  const settingsActive = isSettingsRoutePath(location.pathname);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const routeState = location.state as Record<string, unknown> | null;
  const origin = routeState?.[SHELL_BACK_STATE_KEY];
  const workspaceWasOrigin =
    typeof origin === 'string' && (origin === '/' || origin.startsWith('/?'));
  const shouldMountWorkspace = !settingsActive || workspaceWasOrigin;

  // React 18 does not serialize the HTML inert boolean attribute correctly,
  // so reflect it explicitly until the app moves to a React version that does.
  useLayoutEffect(() => {
    workspaceRef.current?.toggleAttribute('inert', settingsActive);
  }, [settingsActive]);

  return (
    <>
      {shouldMountWorkspace ? (
        <div
          ref={workspaceRef}
          className="h-full min-h-0 w-full"
          hidden={settingsActive}
          aria-hidden={settingsActive || undefined}
        >
          {workspace}
        </div>
      ) : null}
      <Outlet />
    </>
  );
}
