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
  APP_COMMAND,
  type AppCommandId,
} from '../../../src/shared/appCommands';
import { getKeyboardShortcutsAccelerator } from '../../../src/shared/keyboardShortcuts';
import {
  assertUniqueInstalledAccelerators,
  isTerminalOwnedAccelerator,
  type DesktopMenuPlatform,
} from './accelerators';
import { EIGENT_GITHUB_REPOSITORY_URL } from './catalog';

export interface ApplicationMenuOptions {
  appName: string;
  dispatchRendererCommand: (commandId: AppCommandId) => void;
  isDevelopment: boolean;
  onOpenExternalError?: (error: unknown) => void;
  openExternal: (url: string) => Promise<void>;
  platform: DesktopMenuPlatform;
  /** Guarded close request; must not force-close the BrowserWindow. */
  requestClose: () => void;
  /** Guarded application quit request; intentionally not Electron's quit role. */
  requestQuit: () => void;
}

export interface ApplicationMenuApi<TMenu = Electron.Menu> {
  buildFromTemplate: (template: Electron.MenuItemConstructorOptions[]) => TMenu;
  setApplicationMenu: (menu: TMenu | null) => void;
}

const separator = (): Electron.MenuItemConstructorOptions => ({
  type: 'separator',
});

function platformAccelerator(
  platform: DesktopMenuPlatform,
  mac: string,
  other: string
): string {
  return platform === 'darwin' ? mac : other;
}

function editRole(
  platform: DesktopMenuPlatform,
  options: Pick<
    Electron.MenuItemConstructorOptions,
    'accelerator' | 'id' | 'label' | 'role'
  >
): Electron.MenuItemConstructorOptions {
  return {
    ...options,
    // Preserve visible conventional labels without consuming renderer key
    // events (notably xterm Ctrl+C) on Windows and Linux.
    ...(platform === 'darwin' ? {} : { registerAccelerator: false }),
  };
}

/**
 * Show the conventional accelerator without consuming the renderer's key event,
 * for commands the embedded terminal needs on Windows and Linux.
 */
function terminalSafe(
  platform: DesktopMenuPlatform,
  key: string,
  item: Electron.MenuItemConstructorOptions
): Electron.MenuItemConstructorOptions {
  return isTerminalOwnedAccelerator(key, platform)
    ? { ...item, registerAccelerator: false }
    : item;
}

function buildEditMenu(
  platform: DesktopMenuPlatform
): Electron.MenuItemConstructorOptions {
  return {
    id: 'edit',
    label: platform === 'darwin' ? 'Edit' : '&Edit',
    submenu: [
      editRole(platform, {
        id: 'edit.undo',
        label: 'Undo',
        role: 'undo',
        accelerator: platformAccelerator(platform, 'Command+Z', 'Control+Z'),
      }),
      editRole(platform, {
        id: 'edit.redo',
        label: 'Redo',
        role: 'redo',
        accelerator:
          platform === 'darwin'
            ? 'Command+Shift+Z'
            : platform === 'win32'
              ? 'Control+Y'
              : 'Control+Shift+Z',
      }),
      separator(),
      editRole(platform, {
        id: 'edit.cut',
        label: 'Cut',
        role: 'cut',
        accelerator: platformAccelerator(platform, 'Command+X', 'Control+X'),
      }),
      editRole(platform, {
        id: 'edit.copy',
        label: 'Copy',
        role: 'copy',
        accelerator: platformAccelerator(platform, 'Command+C', 'Control+C'),
      }),
      editRole(platform, {
        id: 'edit.paste',
        label: 'Paste',
        role: 'paste',
        accelerator: platformAccelerator(platform, 'Command+V', 'Control+V'),
      }),
      editRole(platform, {
        id: 'edit.paste-and-match-style',
        label: 'Paste and Match Style',
        role: 'pasteAndMatchStyle',
        accelerator: platformAccelerator(
          platform,
          'Command+Shift+V',
          'Control+Shift+V'
        ),
      }),
      separator(),
      editRole(platform, {
        id: 'edit.select-all',
        label: 'Select All',
        role: 'selectAll',
        accelerator: platformAccelerator(platform, 'Command+A', 'Control+A'),
      }),
    ],
  };
}

function buildViewMenu(
  options: ApplicationMenuOptions
): Electron.MenuItemConstructorOptions {
  const { dispatchRendererCommand, isDevelopment, platform } = options;
  const submenu: Electron.MenuItemConstructorOptions[] = [
    {
      id: 'view.toggle-full-screen',
      label: 'Toggle Full Screen',
      role: 'togglefullscreen',
      accelerator: platform === 'darwin' ? 'Control+Command+F' : 'F11',
    },
    ...[
      {
        id: 'view.navigate-home',
        accelerator: platformAccelerator(
          platform,
          'Command+Shift+H',
          'Control+Shift+H'
        ),
        command: APP_COMMAND.navigateHome,
      },
      {
        id: 'view.navigate-workspace',
        accelerator: platformAccelerator(platform, 'Command+1', 'Control+1'),
        command: APP_COMMAND.navigateWorkspace,
      },
      {
        id: 'view.navigate-files',
        accelerator: platformAccelerator(platform, 'Command+2', 'Control+2'),
        command: APP_COMMAND.navigateFiles,
      },
      {
        id: 'view.navigate-scheduled',
        accelerator: platformAccelerator(platform, 'Command+3', 'Control+3'),
        command: APP_COMMAND.navigateScheduled,
      },
      {
        id: 'view.navigate-dispatch',
        accelerator: platformAccelerator(platform, 'Command+4', 'Control+4'),
        command: APP_COMMAND.navigateDispatch,
      },
      {
        id: 'view.navigate-configuration',
        accelerator: platformAccelerator(platform, 'Command+5', 'Control+5'),
        command: APP_COMMAND.navigateConfiguration,
      },
      {
        id: 'view.toggle-workspace-sidebar',
        accelerator: platformAccelerator(platform, 'Command+B', 'Control+B'),
        command: APP_COMMAND.toggleWorkspaceSidebar,
        terminalKey: 'B',
      },
      {
        id: 'view.toggle-timeline-view',
        accelerator: platformAccelerator(
          platform,
          'Command+Shift+L',
          'Control+Shift+L'
        ),
        command: APP_COMMAND.toggleTimelineView,
      },
      {
        id: 'view.toggle-preview-panel',
        accelerator: platformAccelerator(
          platform,
          'Command+Shift+P',
          'Control+Shift+P'
        ),
        command: APP_COMMAND.togglePreviewPanel,
      },
      {
        id: 'view.open-preview-browser',
        accelerator: platformAccelerator(
          platform,
          'Command+Shift+B',
          'Control+Shift+B'
        ),
        command: APP_COMMAND.openPreviewBrowser,
      },
      {
        id: 'view.open-preview-terminal',
        accelerator: platformAccelerator(
          platform,
          'Command+Shift+T',
          'Control+Shift+T'
        ),
        command: APP_COMMAND.openPreviewTerminal,
      },
      {
        id: 'view.toggle-session-side-panel',
        accelerator: platformAccelerator(
          platform,
          'Command+Shift+E',
          'Control+Shift+E'
        ),
        command: APP_COMMAND.toggleSessionSidePanel,
      },
    ].map(({ command, terminalKey, ...item }) =>
      terminalSafe(platform, terminalKey ?? '', {
        ...item,
        label: item.id,
        visible: false,
        click: () => dispatchRendererCommand(command),
      })
    ),
  ];

  if (isDevelopment) {
    submenu.push(
      separator(),
      {
        id: 'view.reload',
        label: 'Reload',
        role: 'reload',
        accelerator: platformAccelerator(platform, 'Command+R', 'Control+R'),
      },
      {
        id: 'view.toggle-developer-tools',
        label: 'Toggle Developer Tools',
        role: 'toggleDevTools',
        accelerator:
          platform === 'darwin' ? 'Command+Shift+I' : 'Control+Shift+I',
      },
      {
        id: 'view.toggle-developer-tools-f12',
        label: 'Toggle Developer Tools (F12)',
        role: 'toggleDevTools',
        accelerator: 'F12',
        visible: false,
      }
    );
  }

  return {
    id: 'view',
    label: platform === 'darwin' ? 'View' : '&View',
    submenu,
  };
}

function buildWindowMenu(
  platform: DesktopMenuPlatform
): Electron.MenuItemConstructorOptions {
  return {
    id: 'window',
    label: platform === 'darwin' ? 'Window' : '&Window',
    submenu:
      platform === 'darwin'
        ? [
            {
              id: 'window.minimize',
              label: 'Minimize',
              role: 'minimize',
              accelerator: 'Command+M',
            },
            { id: 'window.zoom', label: 'Zoom', role: 'zoom' },
            separator(),
            { id: 'window.front', label: 'Bring All to Front', role: 'front' },
            { id: 'window.list', role: 'window' },
          ]
        : [{ id: 'window.minimize', label: 'Minimize', role: 'minimize' }],
  };
}

function buildHelpMenu(
  options: ApplicationMenuOptions
): Electron.MenuItemConstructorOptions {
  const {
    appName,
    dispatchRendererCommand,
    onOpenExternalError,
    openExternal,
  } = options;

  const submenu: Electron.MenuItemConstructorOptions[] = [
    {
      id: 'help.keyboard-shortcuts',
      label: 'Keyboard Shortcuts…',
      accelerator: getKeyboardShortcutsAccelerator(options.platform),
      click: () => dispatchRendererCommand(APP_COMMAND.keyboardShortcuts),
    },
    separator(),
    {
      id: 'help.report-bug',
      label: 'Report a Bug…',
      click: () => dispatchRendererCommand(APP_COMMAND.reportBug),
    },
    {
      id: 'help.github',
      label: 'Eigent on GitHub',
      click: () => {
        void openExternal(EIGENT_GITHUB_REPOSITORY_URL).catch((error) => {
          onOpenExternalError?.(error);
        });
      },
    },
  ];

  if (options.platform !== 'darwin') {
    submenu.push(separator(), {
      id: 'help.about',
      label: `About ${appName}`,
      role: 'about',
    });
  }

  return {
    id: 'help',
    ...(options.platform === 'darwin'
      ? { role: 'help' as const }
      : { label: '&Help' }),
    submenu,
  };
}

function buildMacAppMenu(
  options: ApplicationMenuOptions
): Electron.MenuItemConstructorOptions {
  const { appName, dispatchRendererCommand, requestQuit } = options;
  return {
    id: 'app',
    label: appName,
    submenu: [
      { id: 'app.about', label: `About ${appName}`, role: 'about' },
      separator(),
      {
        id: 'app.settings',
        label: 'Settings…',
        accelerator: 'Command+,',
        click: () => dispatchRendererCommand(APP_COMMAND.openSettings),
      },
      separator(),
      { id: 'app.services', role: 'services' },
      separator(),
      { id: 'app.hide', label: `Hide ${appName}`, role: 'hide' },
      { id: 'app.hide-others', label: 'Hide Others', role: 'hideOthers' },
      { id: 'app.unhide', label: 'Show All', role: 'unhide' },
      separator(),
      {
        id: 'app.quit',
        label: `Quit ${appName}`,
        accelerator: 'Command+Q',
        // Deliberately custom: the native quit role bypasses Eigent's active-run
        // confirmation and shutdown coordination.
        click: requestQuit,
      },
    ],
  };
}

function buildFileMenu(
  options: ApplicationMenuOptions
): Electron.MenuItemConstructorOptions {
  const { dispatchRendererCommand, platform, requestClose, requestQuit } =
    options;
  const submenu: Electron.MenuItemConstructorOptions[] = [
    terminalSafe(platform, 'N', {
      id: 'file.new-project',
      label: 'New Project',
      accelerator: platformAccelerator(platform, 'Command+N', 'Control+N'),
      click: () => dispatchRendererCommand(APP_COMMAND.newProject),
    }),
  ];

  if (platform !== 'darwin') {
    submenu.push({
      id: 'file.settings',
      label: 'Settings…',
      accelerator: 'Control+,',
      click: () => dispatchRendererCommand(APP_COMMAND.openSettings),
    });
  }

  submenu.push(
    separator(),
    terminalSafe(platform, 'W', {
      id: 'file.close-window',
      label: 'Close Window',
      accelerator: platformAccelerator(platform, 'Command+W', 'Control+W'),
      click: requestClose,
    })
  );

  if (platform !== 'darwin') {
    submenu.push(separator(), {
      id: 'file.exit',
      label: 'Exit',
      // Deliberately custom for the same reason as macOS Quit.
      click: requestQuit,
    });
  }

  return {
    id: 'file',
    label: platform === 'darwin' ? 'File' : '&File',
    submenu,
  };
}

/** Build the entire native menu without importing Electron at runtime. */
export function buildApplicationMenuTemplate(
  options: ApplicationMenuOptions
): Electron.MenuItemConstructorOptions[] {
  const template = [
    ...(options.platform === 'darwin' ? [buildMacAppMenu(options)] : []),
    buildFileMenu(options),
    buildEditMenu(options.platform),
    buildViewMenu(options),
    buildWindowMenu(options.platform),
    buildHelpMenu(options),
  ];

  assertUniqueInstalledAccelerators(template, options.platform);
  return template;
}

/** Build and install the application menu through an injected Electron API. */
export function installApplicationMenu<TMenu = Electron.Menu>(
  menuApi: ApplicationMenuApi<TMenu>,
  options: ApplicationMenuOptions
): TMenu {
  const menu = menuApi.buildFromTemplate(buildApplicationMenuTemplate(options));
  menuApi.setApplicationMenu(menu);
  return menu;
}
