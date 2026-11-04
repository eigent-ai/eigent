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

import { useHomeVisitTracking } from '@/components/Home/homeVisit';
import { useAppCommand } from '@/components/Layout/AppCommandProvider';
import { APP_SHELL_RAIL_WIDTH_PX } from '@/components/Layout/AppShellLayout';
import {
  canRenameSpace,
  SpaceRenameDialog,
} from '@/components/SpaceSidebar/SpaceRenameDialog';
import { UserMenu } from '@/components/TopBar/UserMenu';
import { DsIcon } from '@/components/ui/ds-icon';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { useSpaceAttention } from '@/hooks/useSpaceAttention';
import { useOpenSpaceHomeTab, useSpaceSwitch } from '@/hooks/useSpaceSwitch';
import { SESSION_WINDOW_ROUTE } from '@/lib/sessionWindows';
import { isHomePagePath, isSettingsPagePath } from '@/lib/shellRoutes';
import { getActiveSpaceTriggerLabel } from '@/lib/spaceLabel';
import { APP_COMMAND, PINNED_SPACE_COMMANDS } from '@/shared/appCommands';
import { usePageTabStore, type ShellPlace } from '@/store/pageTabStore';
import { openSettings } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { House, Settings } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { matchPath, useLocation } from 'react-router-dom';
import { AppRailButton } from './AppRailButton';
import { pinSpaceOrChoose, usePinnedSpaceIds } from './pinnedSpaces';
import { PinnedSpacesChooser } from './PinnedSpacesChooser';
import { SpaceRailTile } from './SpaceRailTile';
import { SpaceRailTileMenu } from './SpaceRailTileMenu';

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

/** `/` is Home or the Space view, whichever place the shell last showed. */
export function getAppRailPlace(
  pathname: string,
  shellPlace: ShellPlace = 'space'
): AppRailPlace | null {
  if (pathname === '/') return shellPlace;
  if (isHomePagePath(pathname)) return 'home';
  if (isSettingsPagePath(pathname)) return 'settings';
  return null;
}

/**
 * The window's places, under the top bar and left of every page: Home, up to
 * ten pinned Spaces, the active Space when it isn't pinned, the pin chooser,
 * Settings, and the account menu. It sits on the same chrome surface as the
 * top bar and stays when the page sidebar folds.
 */
export default function AppRail() {
  const { t } = useTranslation();
  const location = useLocation();
  const executeAppCommand = useAppCommand();
  const { openSpaceView } = useSpaceSwitch();
  const openSpaceHomeTab = useOpenSpaceHomeTab();
  const attention = useSpaceAttention();
  const pinnedIds = usePinnedSpaceIds();
  const spaces = useSpaceStore((state) => state.spaces);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const unpinSpace = useSpaceStore((state) => state.unpinSpace);
  const moveSpacePin = useSpaceStore((state) => state.moveSpacePin);
  const [renameSpaceId, setRenameSpaceId] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const shellPlace = usePageTabStore((state) => state.shellPlace);
  const place = getAppRailPlace(location.pathname, shellPlace);
  useHomeVisitTracking(place === 'home');

  const openHome = useCallback(() => {
    executeAppCommand(APP_COMMAND.navigateHome);
  }, [executeAppCommand]);

  // Reopen the section used last; ⌘, keeps opening the Settings section.
  const openSettingsPage = useCallback(() => {
    openSettings();
  }, []);

  const homeLabel = t('layout.home');
  const settingsLabel = t('layout.settings');
  const activeSpace = activeSpaceId ? spaces[activeSpaceId] : undefined;
  const showActiveTile =
    activeSpace !== undefined && !pinnedIds.includes(activeSpace.id);

  const renderTile = (spaceId: string, pinIndex: number) => {
    const space = spaces[spaceId];
    if (!space) return null;
    const pinned = pinIndex >= 0;
    return (
      // A new pin settles into place once; dots changing never move tiles.
      <motion.div
        key={spaceId}
        className="w-full shrink-0"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
      >
        <SpaceRailTile
          name={getActiveSpaceTriggerLabel(space.name, t)}
          pinned={pinned}
          selected={place === 'space' && spaceId === activeSpaceId}
          attention={attention[spaceId]}
          shortcutId={
            pinned && pinIndex < PINNED_SPACE_COMMANDS.length
              ? PINNED_SPACE_COMMANDS[pinIndex]
              : undefined
          }
          onClick={() => openSpaceView(spaceId)}
          menu={
            <SpaceRailTileMenu
              pinned={pinned}
              canRename={canRenameSpace(space)}
              pinIndex={pinIndex}
              pinCount={pinnedIds.length}
              onOpen={() => openSpaceView(spaceId)}
              onTogglePin={() => {
                if (pinned) unpinSpace(spaceId);
                else pinSpaceOrChoose(spaceId);
              }}
              onRename={() => setRenameSpaceId(spaceId)}
              onOpenSpaceSettings={() =>
                openSpaceHomeTab(spaceId, 'workspace-profile')
              }
              onMove={(toIndex) => moveSpacePin(spaceId, toIndex)}
            />
          }
        />
      </motion.div>
    );
  };

  return (
    <nav
      aria-label={t('layout.app-navigation')}
      data-app-rail
      className="flex h-full min-h-0 shrink-0 flex-col items-center gap-ds-4 overflow-hidden pt-10 pb-ds-8"
      style={{ width: APP_SHELL_RAIL_WIDTH_PX }}
    >
      <SpaceRenameDialog
        spaceId={renameSpaceId}
        onClose={() => setRenameSpaceId(null)}
      />
      {/* The sidebar's first row sits below the shell's top inset (`py-ds-4`),
          so Home starts there too and lines up with it. */}
      <div className="w-full shrink-0 pt-ds-4">
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
      </div>

      <span
        aria-hidden
        className="my-ds-2 w-ds-24 shrink-0 border-x-0 border-t-[0.5px] border-b-0 border-solid border-ds-hairline-subtle-default"
      />

      {/* Ten pins and the active tile fit at the minimum window height; a
          shorter window or a large zoom scrolls the tiles instead. */}
      <div
        data-app-rail-spaces
        className="scrollbar-hide flex min-h-0 w-full flex-col items-center gap-ds-4 overflow-x-hidden overflow-y-auto"
      >
        <AnimatePresence initial={false}>
          {pinnedIds.map((spaceId, index) => renderTile(spaceId, index))}
          {showActiveTile ? renderTile(activeSpace.id, -1) : null}
        </AnimatePresence>
      </div>
      <PinnedSpacesChooser />

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
