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

import { useAppCommand } from '@/components/Layout/AppCommandProvider';
import { APP_SHELL_RAIL_WIDTH_PX } from '@/components/Layout/AppShellLayout';
import { UserMenu } from '@/components/TopBar/UserMenu';
import { DsIcon } from '@/components/ui/ds-icon';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { SESSION_WINDOW_ROUTE } from '@/lib/sessionWindows';
import { isHomePagePath, isSettingsPagePath } from '@/lib/shellRoutes';
import { getActiveSpaceTriggerLabel } from '@/lib/spaceLabel';
import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import { APP_COMMAND } from '@/shared/appCommands';
import { openSettings, useSettingsStore } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { House, Settings } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { AppRailButton } from './AppRailButton';
import { SpaceRailTile } from './SpaceRailTile';

/** Pages drawn without the app shell: sign-in and a Session's own window. */
const RAIL_HIDDEN_ROUTES = ['/login', '/signup', SESSION_WINDOW_ROUTE];

/**
 * The rail belongs to the main shell only. The install screen covers the
 * shell, and sign-in and Session windows never render it.
 */
export function shouldShowAppRail(
  pathname: string,
  installScreenVisible: boolean
): boolean {
  if (installScreenVisible) return false;
  return !RAIL_HIDDEN_ROUTES.some((path) =>
    matchPath({ path, end: true }, pathname)
  );
}

export type AppRailPlace = 'home' | 'space' | 'settings';

export function getAppRailPlace(pathname: string): AppRailPlace | null {
  if (pathname === '/') return 'space';
  if (isHomePagePath(pathname)) return 'home';
  if (isSettingsPagePath(pathname)) return 'settings';
  return null;
}

/**
 * The window's places, under the top bar and left of every page: Home, the
 * active Space, Settings, and the account menu. It sits on the same chrome
 * surface as the top bar and stays when the page sidebar folds.
 */
export default function AppRail() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const executeAppCommand = useAppCommand();
  const closeSettings = useSettingsStore((state) => state.closeSettings);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const activeSpaceName = useSpaceStore((state) =>
    state.activeSpaceId ? state.spaces[state.activeSpaceId]?.name : undefined
  );
  const place = getAppRailPlace(location.pathname);

  const openHome = useCallback(() => {
    executeAppCommand(APP_COMMAND.navigateHome);
  }, [executeAppCommand]);

  const openSpaceView = useCallback(() => {
    void runAfterWorkspaceConfigurationSave(() => {
      closeSettings();
      navigate('/');
    });
  }, [closeSettings, navigate]);

  // Reopen the section used last; ⌘, keeps opening the Settings section.
  const openSettingsPage = useCallback(() => {
    openSettings();
  }, []);

  const homeLabel = t('layout.home');
  const settingsLabel = t('layout.settings');

  return (
    <nav
      aria-label={t('layout.app-navigation')}
      data-app-rail
      className="flex h-full min-h-0 shrink-0 flex-col items-center gap-ds-4 overflow-hidden pt-10 pb-ds-8"
      style={{ width: APP_SHELL_RAIL_WIDTH_PX }}
    >
      <AppRailButton
        label={homeLabel}
        tooltip={
          <ShortcutTooltipContent
            label={homeLabel}
            shortcutId="navigate-home"
          />
        }
        selected={place === 'home'}
        onClick={openHome}
      >
        <DsIcon icon={House} aria-hidden />
      </AppRailButton>

      <span
        aria-hidden
        className="my-ds-2 w-ds-24 shrink-0 border-x-0 border-t-[0.5px] border-b-0 border-solid border-ds-hairline-subtle-default"
      />

      {activeSpaceId ? (
        <SpaceRailTile
          name={getActiveSpaceTriggerLabel(activeSpaceName, t)}
          selected={place === 'space'}
          onClick={openSpaceView}
        />
      ) : null}

      <div className="min-h-0 flex-1" />

      <AppRailButton
        label={settingsLabel}
        tooltip={
          <ShortcutTooltipContent label={settingsLabel} shortcutId="settings" />
        }
        selected={place === 'settings'}
        onClick={openSettingsPage}
      >
        <DsIcon icon={Settings} aria-hidden />
      </AppRailButton>

      <div className="flex w-full shrink-0 justify-center">
        <UserMenu />
      </div>
    </nav>
  );
}
