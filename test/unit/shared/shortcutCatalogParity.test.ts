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
import { normalizeAccelerator } from '../../../electron/main/commands/accelerators';
import { buildApplicationMenuTemplate } from '../../../electron/main/commands/applicationMenu';
import { getNativeMenuMessages } from '../../../electron/main/commands/nativeMenuMessages';
import {
  formatKeyboardShortcutKeys,
  getKeyboardShortcutGroups,
  type DesktopShortcutPlatform,
} from '../../../src/shared/keyboardShortcuts';

/**
 * The Keyboard Shortcuts sheet and the native menu are two hand-maintained
 * lists. Nothing at runtime forces them to agree, so a menu accelerator can
 * drift and the sheet will quietly advertise a shortcut that does nothing.
 * This pins the pairs that must stay identical.
 */
const MENU_ITEM_TO_SHORTCUT_ID: Record<string, string> = {
  'app.settings': 'settings',
  'file.settings': 'settings',
  'file.new-project': 'new-project',
  'file.close-window': 'close-window',
  'help.keyboard-shortcuts': 'keyboard-shortcuts',
  'view.toggle-full-screen': 'full-screen',
  'view.navigate-home': 'navigate-home',
  'view.navigate-workspace': 'navigate-workspace',
  'view.navigate-files': 'navigate-files',
  'view.navigate-scheduled': 'navigate-scheduled',
  'view.navigate-dispatch': 'navigate-dispatch',
  'view.navigate-configuration': 'navigate-configuration',
  'view.toggle-workspace-sidebar': 'toggle-workspace-sidebar',
  'view.toggle-timeline-view': 'toggle-timeline-view',
  'view.toggle-preview-panel': 'toggle-preview-panel',
  'view.open-preview-browser': 'open-preview-browser',
  'view.open-preview-terminal': 'open-preview-terminal',
  'view.toggle-session-side-panel': 'toggle-session-side-panel',
  'window.minimize': 'minimize',
  'app.quit': 'quit',
  'edit.undo': 'undo',
  'edit.redo': 'redo',
  'edit.cut': 'cut',
  'edit.copy': 'copy',
  'edit.paste': 'paste',
  'edit.paste-and-match-style': 'paste-match-style',
  'edit.select-all': 'select-all',
};

/** Shortcuts the sheet lists that the renderer -- not the menu -- implements. */
const RENDERER_OWNED_SHORTCUT_IDS = ['global-search', 'save-point'];

const PLATFORMS: DesktopShortcutPlatform[] = ['darwin', 'win32', 'linux'];

function flattenMenu(
  template: Electron.MenuItemConstructorOptions[]
): Electron.MenuItemConstructorOptions[] {
  return template.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flattenMenu(item.submenu) : []),
  ]);
}

function buildTemplate(platform: DesktopShortcutPlatform) {
  return buildApplicationMenuTemplate({
    appName: 'Eigent',
    dispatchRendererCommand: vi.fn(),
    isDevelopment: false,
    messages: getNativeMenuMessages('en-US'),
    openExternal: vi.fn().mockResolvedValue(undefined),
    platform,
    requestClose: vi.fn(),
    requestQuit: vi.fn(),
  });
}

describe.each(PLATFORMS)('shortcut catalog parity on %s', (platform) => {
  const template = buildTemplate(platform);
  const menuItems = flattenMenu(template);
  const catalog = getKeyboardShortcutGroups(platform);
  const catalogById = new Map(
    catalog.flatMap((group) => group.shortcuts).map((item) => [item.id, item])
  );

  it('gives every menu accelerator the same keys the sheet advertises', () => {
    const mismatches: string[] = [];

    for (const item of menuItems) {
      if (!item.id || !item.accelerator) continue;
      const shortcutId = MENU_ITEM_TO_SHORTCUT_ID[item.id];
      if (!shortcutId) continue;

      const shortcut = catalogById.get(shortcutId);
      if (!shortcut) {
        mismatches.push(`${item.id} -> no catalog entry "${shortcutId}"`);
        continue;
      }

      const menuKeys = normalizeAccelerator(item.accelerator, platform);
      const sheetKeys = normalizeAccelerator(
        formatKeyboardShortcutKeys(shortcut.keys)
          .replace(/⌘/g, 'Command+')
          .replace(/⌃/g, 'Control+')
          .replace(/⇧/g, 'Shift+')
          .replace(/\+$/, ''),
        platform
      );

      if (menuKeys !== sheetKeys) {
        mismatches.push(`${item.id}: menu ${menuKeys} vs sheet ${sheetKeys}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('backs every listed shortcut with a menu item or a renderer handler', () => {
    const mappedShortcutIds = new Set(
      menuItems
        .filter((item) => item.id && MENU_ITEM_TO_SHORTCUT_ID[item.id])
        .map((item) => MENU_ITEM_TO_SHORTCUT_ID[item.id as string])
    );

    const unbacked = [...catalogById.keys()].filter(
      (id) =>
        !mappedShortcutIds.has(id) && !RENDERER_OWNED_SHORTCUT_IDS.includes(id)
    );

    expect(unbacked).toEqual([]);
  });

  it('names every catalog entry through an i18n key', () => {
    for (const group of catalog) {
      expect(group.labelKey).toMatch(/^layout\.shortcuts\./);
      for (const shortcut of group.shortcuts) {
        expect(shortcut.labelKey).toBe(`layout.shortcuts.${shortcut.id}`);
        expect(shortcut.defaultLabel.length).toBeGreaterThan(0);
      }
    }
  });
});
