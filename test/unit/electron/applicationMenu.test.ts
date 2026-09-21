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

import { describe, expect, it, vi } from 'vitest';
import {
  assertUniqueInstalledAccelerators,
  collectInstalledAccelerators,
  getReservedRendererAccelerators,
  normalizeAccelerator,
  type DesktopMenuPlatform,
} from '../../../electron/main/commands/accelerators';
import {
  buildApplicationMenuTemplate,
  installApplicationMenu,
  type ApplicationMenuOptions,
} from '../../../electron/main/commands/applicationMenu';
import { EIGENT_GITHUB_REPOSITORY_URL } from '../../../electron/main/commands/catalog';
import {
  applyNativeMenuLocaleChange,
  getNativeMenuMessages,
  resolveNativeMenuLocale,
} from '../../../electron/main/commands/nativeMenuMessages';
import { APP_COMMAND } from '../../../src/shared/appCommands';

type MenuItem = Electron.MenuItemConstructorOptions;

function children(item: MenuItem): MenuItem[] {
  return Array.isArray(item.submenu) ? item.submenu : [];
}

function findItem(template: MenuItem[], id: string): MenuItem {
  for (const item of template) {
    if (item.id === id) return item;
    const nested = findItemOrNull(children(item), id);
    if (nested) return nested;
  }
  throw new Error(`Missing menu item ${id}`);
}

function findItemOrNull(template: MenuItem[], id: string): MenuItem | null {
  for (const item of template) {
    if (item.id === id) return item;
    const nested = findItemOrNull(children(item), id);
    if (nested) return nested;
  }
  return null;
}

function click(item: MenuItem): void {
  item.click?.({} as never, undefined, {} as never);
}

function createOptions(platform: DesktopMenuPlatform, isDevelopment = false) {
  const dispatchRendererCommand = vi.fn();
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const requestQuit = vi.fn();
  const onOpenExternalError = vi.fn();
  const options: ApplicationMenuOptions = {
    appName: 'Eigent',
    dispatchRendererCommand,
    isDevelopment,
    messages: getNativeMenuMessages('en-US'),
    onOpenExternalError,
    openExternal,
    platform,
    requestQuit,
  };
  return {
    dispatchRendererCommand,
    onOpenExternalError,
    openExternal,
    options,
    requestQuit,
  };
}

describe('application menu', () => {
  it('builds an explicit macOS menu and routes guarded/app actions', async () => {
    const harness = createOptions('darwin');
    const template = buildApplicationMenuTemplate(harness.options);

    expect(template.map((item) => item.id)).toEqual([
      'app',
      'file',
      'edit',
      'view',
      'window',
      'help',
    ]);
    expect(template[0].label).toBe('Eigent');

    const quit = findItem(template, 'app.quit');
    const close = findItem(template, 'file.close-window');
    expect(quit.role).toBeUndefined();
    expect(close.role).toBeUndefined();
    expect(findItemOrNull(template, 'file.exit')).toBeNull();
    expect(
      template.flatMap(children).some((item) => item.role === 'quit')
    ).toBe(false);

    click(findItem(template, 'app.settings'));
    click(findItem(template, 'file.new-project'));
    click(findItem(template, 'help.keyboard-shortcuts'));
    click(findItem(template, 'help.report-bug'));
    click(findItem(template, 'view.toggle-timeline-view'));
    click(findItem(template, 'view.toggle-preview-panel'));
    click(findItem(template, 'view.open-preview-browser'));
    click(findItem(template, 'view.open-preview-terminal'));
    click(findItem(template, 'view.toggle-workspace-sidebar'));
    click(findItem(template, 'view.toggle-session-side-panel'));
    click(findItem(template, 'view.navigate-home'));
    click(findItem(template, 'view.navigate-workspace'));
    click(findItem(template, 'view.navigate-files'));
    click(findItem(template, 'view.navigate-scheduled'));
    click(findItem(template, 'view.navigate-dispatch'));
    click(findItem(template, 'view.navigate-configuration'));
    click(close);
    click(quit);
    click(findItem(template, 'help.github'));
    await Promise.resolve();

    expect(harness.dispatchRendererCommand.mock.calls).toEqual([
      [APP_COMMAND.openSettings],
      [APP_COMMAND.newProject],
      [APP_COMMAND.keyboardShortcuts],
      [APP_COMMAND.reportBug],
      [APP_COMMAND.toggleTimelineView],
      [APP_COMMAND.togglePreviewPanel],
      [APP_COMMAND.openPreviewBrowser],
      [APP_COMMAND.openPreviewTerminal],
      [APP_COMMAND.toggleWorkspaceSidebar],
      [APP_COMMAND.toggleSessionSidePanel],
      [APP_COMMAND.navigateHome],
      [APP_COMMAND.navigateWorkspace],
      [APP_COMMAND.navigateFiles],
      [APP_COMMAND.navigateScheduled],
      [APP_COMMAND.navigateDispatch],
      [APP_COMMAND.navigateConfiguration],
    ]);
    expect(findItem(template, 'help.keyboard-shortcuts').accelerator).toBe(
      'Command+/'
    );
    expect(harness.requestQuit).toHaveBeenCalledTimes(2);
    expect(harness.openExternal).toHaveBeenCalledWith(
      EIGENT_GITHUB_REPOSITORY_URL
    );
  });

  it.each(['win32', 'linux'] as const)(
    'uses conventional auto-hide-ready menus on %s without registering Edit accelerators',
    (platform) => {
      const harness = createOptions(platform);
      const template = buildApplicationMenuTemplate(harness.options);

      expect(template.map((item) => item.id)).toEqual([
        'file',
        'edit',
        'view',
        'window',
        'help',
      ]);
      expect(template.map((item) => item.label)).toEqual([
        '&File',
        '&Edit',
        '&View',
        '&Window',
        '&Help',
      ]);

      const editCommands = children(findItem(template, 'edit')).filter(
        (item) => item.type !== 'separator'
      );
      expect(editCommands).not.toHaveLength(0);
      expect(
        editCommands.every((item) => item.registerAccelerator === false)
      ).toBe(true);

      const exit = findItem(template, 'file.exit');
      const close = findItem(template, 'file.close-window');
      expect(exit.role).toBeUndefined();
      expect(close.role).toBeUndefined();
      click(findItem(template, 'file.settings'));
      click(findItem(template, 'help.keyboard-shortcuts'));
      expect(harness.dispatchRendererCommand).toHaveBeenCalledWith(
        APP_COMMAND.openSettings
      );
      expect(harness.dispatchRendererCommand).toHaveBeenCalledWith(
        APP_COMMAND.keyboardShortcuts
      );
      expect(findItem(template, 'help.keyboard-shortcuts').accelerator).toBe(
        'Control+/'
      );
    }
  );

  it.each(['win32', 'linux'] as const)(
    'routes Close Window through guarded quit semantics on %s',
    (platform) => {
      const harness = createOptions(platform);
      const template = buildApplicationMenuTemplate(harness.options);

      click(findItem(template, 'file.close-window'));

      expect(harness.requestQuit).toHaveBeenCalledOnce();

      click(findItem(template, 'file.exit'));
      expect(harness.requestQuit).toHaveBeenCalledTimes(2);
    }
  );

  it('localizes every visible application label without relying on role defaults', () => {
    const harness = createOptions('darwin');
    harness.options.messages = getNativeMenuMessages('zh-Hans');
    const template = buildApplicationMenuTemplate(harness.options);

    expect(findItem(template, 'file').label).toBe('文件');
    expect(findItem(template, 'edit.undo').label).toBe('撤销');
    expect(findItem(template, 'window.front').label).toBe('全部置于前面');
    expect(findItem(template, 'help.report-bug').label).toBe('报告问题…');
    expect(findItem(template, 'app.about').label).toBe('关于 Eigent');

    const visibleItems = (items: MenuItem[]): MenuItem[] =>
      items.flatMap((item) => [item, ...visibleItems(children(item))]);
    expect(
      visibleItems(template)
        .filter((item) => item.type !== 'separator' && item.visible !== false)
        .every(
          (item) => typeof item.label === 'string' && item.label.length > 0
        )
    ).toBe(true);
  });

  it('normalizes system locales and falls back to English', () => {
    expect(resolveNativeMenuLocale('en')).toBe('en-US');
    expect(resolveNativeMenuLocale('zh_TW')).toBe('zh-Hant');
    expect(resolveNativeMenuLocale('zh-CN')).toBe('zh-Hans');
    expect(resolveNativeMenuLocale('de-DE')).toBe('de');
    expect(resolveNativeMenuLocale('pt-BR')).toBe('en-US');
    expect(getNativeMenuMessages('pt-BR').file).toBe('File');
  });

  it('rebuilds once for a validated locale change', () => {
    const rebuild = vi.fn();

    expect(applyNativeMenuLocaleChange('en-US', 'zh-Hans', rebuild)).toBe(true);
    expect(applyNativeMenuLocaleChange('zh-Hans', 'zh-Hans', rebuild)).toBe(
      false
    );
    expect(
      applyNativeMenuLocaleChange('zh-Hans', 'not-a-locale', rebuild)
    ).toBe(false);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(rebuild).toHaveBeenCalledWith('zh-Hans');
  });

  it('keeps reload and Developer Tools out of packaged menus', () => {
    const production = buildApplicationMenuTemplate(
      createOptions('darwin').options
    );
    expect(findItemOrNull(production, 'view.reload')).toBeNull();
    expect(
      findItemOrNull(production, 'view.toggle-developer-tools')
    ).toBeNull();
    expect(
      findItemOrNull(production, 'view.toggle-developer-tools-f12')
    ).toBeNull();

    const development = buildApplicationMenuTemplate(
      createOptions('darwin', true).options
    );
    expect(findItem(development, 'view.reload').role).toBe('reload');
    expect(findItem(development, 'view.toggle-developer-tools').role).toBe(
      'toggleDevTools'
    );
    expect(
      findItem(development, 'view.toggle-developer-tools').accelerator
    ).toBe('Command+Shift+I');
    expect(
      findItem(development, 'view.toggle-developer-tools-f12')
    ).toMatchObject({
      accelerator: 'F12',
      role: 'toggleDevTools',
      visible: false,
    });
  });

  it('keeps app shortcuts hidden while registering their accelerators', () => {
    const production = buildApplicationMenuTemplate(
      createOptions('darwin').options
    );

    expect(findItem(production, 'view.toggle-full-screen').visible).not.toBe(
      false
    );
    expect(findItem(production, 'view.toggle-workspace-sidebar')).toMatchObject(
      {
        accelerator: 'Command+B',
        visible: false,
      }
    );
    expect(findItem(production, 'view.toggle-timeline-view')).toMatchObject({
      accelerator: 'Command+Shift+L',
      visible: false,
    });
    expect(findItem(production, 'view.navigate-home')).toMatchObject({
      accelerator: 'Command+Shift+H',
      visible: false,
    });
    expect(
      [
        'view.navigate-workspace',
        'view.navigate-files',
        'view.navigate-scheduled',
        'view.navigate-dispatch',
        'view.navigate-configuration',
      ].map((id) => findItem(production, id).accelerator)
    ).toEqual([
      'Command+1',
      'Command+2',
      'Command+3',
      'Command+4',
      'Command+5',
    ]);
    expect(findItemOrNull(production, 'view.reset-zoom')).toBeNull();
    expect(findItemOrNull(production, 'view.zoom-in')).toBeNull();
    expect(findItemOrNull(production, 'view.zoom-out')).toBeNull();
    expect(findItem(production, 'help.report-bug').label).toBe('Report a Bug…');
  });

  it.each(['darwin', 'win32', 'linux'] as const)(
    'installs no duplicate or renderer-reserved accelerator on %s',
    (platform) => {
      const template = buildApplicationMenuTemplate(
        createOptions(platform, true).options
      );
      const installed = collectInstalledAccelerators(template, platform);
      const normalized = installed.map((item) => item.normalized);
      const reserved = getReservedRendererAccelerators(platform).map(
        (accelerator) => normalizeAccelerator(accelerator, platform)
      );

      expect(new Set(normalized).size).toBe(normalized.length);
      expect(normalized.some((value) => reserved.includes(value))).toBe(false);
    }
  );

  it('rejects aliases of reserved and duplicate accelerators', () => {
    expect(() =>
      assertUniqueInstalledAccelerators(
        [
          {
            id: 'conflict.search',
            label: 'Search',
            accelerator: 'CmdOrCtrl+K',
          },
        ],
        'darwin'
      )
    ).toThrow(/renderer-reserved accelerator/i);

    expect(() =>
      assertUniqueInstalledAccelerators(
        [
          { id: 'first', label: 'First', accelerator: 'Control+Shift+P' },
          { id: 'second', label: 'Second', accelerator: 'shift+ctrl+p' },
        ],
        'win32',
        []
      )
    ).toThrow(/assigned to both/i);
  });

  it('builds and installs through the injected native Menu API', () => {
    const nativeMenu = { id: 'native-menu' };
    const buildFromTemplate = vi.fn(() => nativeMenu);
    const setApplicationMenu = vi.fn();

    expect(
      installApplicationMenu(
        { buildFromTemplate, setApplicationMenu },
        createOptions('linux').options
      )
    ).toBe(nativeMenu);
    expect(buildFromTemplate).toHaveBeenCalledOnce();
    expect(setApplicationMenu).toHaveBeenCalledWith(nativeMenu);
  });

  describe('terminal-owned accelerators', () => {
    it('leaves terminal-owned Ctrl shortcuts unregistered on Windows and Linux', () => {
      for (const platform of ['win32', 'linux'] as DesktopMenuPlatform[]) {
        const template = buildApplicationMenuTemplate(
          createOptions(platform).options
        );

        for (const id of [
          'file.new-project',
          'file.close-window',
          'view.toggle-workspace-sidebar',
        ]) {
          const item = findItem(template, id);
          // The label still shows the conventional shortcut; the accelerator
          // is not installed so xterm keeps readline's Ctrl+N / Ctrl+B / Ctrl+W.
          expect(item.accelerator).toBeTruthy();
          expect(item.registerAccelerator).toBe(false);
        }

        const installed = collectInstalledAccelerators(template, platform).map(
          (entry) => entry.normalized
        );
        expect(installed).not.toContain('Control+N');
        expect(installed).not.toContain('Control+B');
        expect(installed).not.toContain('Control+W');
      }
    });

    it('keeps registering the corresponding Command shortcuts on macOS', () => {
      const template = buildApplicationMenuTemplate(
        createOptions('darwin').options
      );

      expect(findItem(template, 'file.new-project').registerAccelerator).toBe(
        undefined
      );
      expect(findItem(template, 'file.close-window').registerAccelerator).toBe(
        undefined
      );

      const installed = collectInstalledAccelerators(template, 'darwin').map(
        (entry) => entry.normalized
      );
      expect(installed).toContain('Command+N');
      expect(installed).toContain('Command+B');
      expect(installed).toContain('Command+W');
    });
  });
});
