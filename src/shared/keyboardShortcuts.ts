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

export type DesktopShortcutPlatform = 'darwin' | 'win32' | 'linux';

export interface KeyboardShortcutItem {
  id: string;
  keys: readonly string[];
  /** i18n key; the renderer resolves it, the native menu never reads it. */
  labelKey: string;
  /** English fallback for locales that have not translated the sheet yet. */
  defaultLabel: string;
}

export interface KeyboardShortcutGroup {
  id: string;
  labelKey: string;
  defaultLabel: string;
  shortcuts: readonly KeyboardShortcutItem[];
}

export function resolveDesktopShortcutPlatform(
  value: unknown
): DesktopShortcutPlatform {
  if (typeof value !== 'string') return 'linux';
  const normalized = value.toLowerCase();
  if (normalized === 'darwin' || normalized.includes('mac')) return 'darwin';
  if (normalized === 'win32' || normalized.includes('win')) return 'win32';
  return 'linux';
}

export function getKeyboardShortcutsAccelerator(
  platform: DesktopShortcutPlatform
): string {
  return platform === 'darwin' ? 'Command+/' : 'Control+/';
}

export function getKeyboardShortcutsHint(
  platform: DesktopShortcutPlatform
): string {
  return platform === 'darwin' ? '⌘/' : 'Ctrl+/';
}

/** macOS labels the key "Return"; Windows and Linux label it "Enter". */
export function getEnterKeyLabel(platform: DesktopShortcutPlatform): string {
  return platform === 'darwin' ? 'Return' : 'Enter';
}

/** Modifier glyph/word used when composing ad-hoc shortcut labels. */
export function getShiftKeyLabel(platform: DesktopShortcutPlatform): string {
  return platform === 'darwin' ? '\u21e7' : 'Shift';
}

export function getKeyboardShortcutGroups(
  platform: DesktopShortcutPlatform
): readonly KeyboardShortcutGroup[] {
  const isMac = platform === 'darwin';
  const primary = isMac ? '⌘' : 'Ctrl';
  const shift = isMac ? '⇧' : 'Shift';

  return [
    {
      id: 'general',
      labelKey: 'layout.shortcuts.group-general',
      defaultLabel: 'General',
      shortcuts: [
        {
          id: 'navigate-home',
          labelKey: 'layout.shortcuts.navigate-home',
          defaultLabel: 'Go to Home Page',
          keys: [primary, shift, 'H'],
        },
        {
          id: 'settings',
          labelKey: 'layout.shortcuts.settings',
          defaultLabel: 'Settings',
          keys: [primary, ','],
        },
        {
          id: 'keyboard-shortcuts',
          labelKey: 'layout.shortcuts.keyboard-shortcuts',
          defaultLabel: 'Keyboard Shortcuts',
          keys: [primary, '/'],
        },
        {
          id: 'global-search',
          labelKey: 'layout.shortcuts.global-search',
          defaultLabel: 'Global Search',
          keys: [primary, 'K'],
        },
        {
          id: 'toggle-workspace-sidebar',
          labelKey: 'layout.shortcuts.toggle-workspace-sidebar',
          defaultLabel: 'Toggle Workspace Sidebar',
          keys: [primary, 'B'],
        },
        {
          id: 'save-point',
          labelKey: 'layout.shortcuts.save-point',
          defaultLabel: 'Save Point',
          keys: [primary, 'S'],
        },
      ],
    },
    {
      id: 'workspace',
      labelKey: 'layout.shortcuts.group-workspace',
      defaultLabel: 'Workspace',
      shortcuts: [
        {
          id: 'navigate-workspace',
          labelKey: 'layout.shortcuts.navigate-workspace',
          defaultLabel: 'Go to Workspace',
          keys: [primary, '1'],
        },
        {
          id: 'navigate-files',
          labelKey: 'layout.shortcuts.navigate-files',
          defaultLabel: 'Go to Files',
          keys: [primary, '2'],
        },
        {
          id: 'navigate-scheduled',
          labelKey: 'layout.shortcuts.navigate-scheduled',
          defaultLabel: 'Go to Scheduled',
          keys: [primary, '3'],
        },
        {
          id: 'navigate-dispatch',
          labelKey: 'layout.shortcuts.navigate-dispatch',
          defaultLabel: 'Go to Dispatch',
          keys: [primary, '4'],
        },
        {
          id: 'navigate-configuration',
          labelKey: 'layout.shortcuts.navigate-configuration',
          defaultLabel: 'Go to Configuration',
          keys: [primary, '5'],
        },
        {
          id: 'new-project',
          labelKey: 'layout.shortcuts.new-project',
          defaultLabel: 'New session',
          keys: [primary, 'N'],
        },
      ],
    },
    {
      id: 'project',
      labelKey: 'layout.shortcuts.group-project',
      defaultLabel: 'Session',
      shortcuts: [
        {
          id: 'toggle-timeline-view',
          labelKey: 'layout.shortcuts.toggle-timeline-view',
          defaultLabel: 'Toggle Chat / Trajectory View',
          keys: [primary, shift, 'L'],
        },
        {
          id: 'toggle-preview-panel',
          labelKey: 'layout.shortcuts.toggle-preview-panel',
          defaultLabel: 'Toggle Preview Panel',
          keys: [primary, shift, 'P'],
        },
        {
          id: 'open-preview-browser',
          labelKey: 'layout.shortcuts.open-preview-browser',
          defaultLabel: 'Open Browser in Preview',
          keys: [primary, shift, 'B'],
        },
        {
          id: 'open-preview-terminal',
          labelKey: 'layout.shortcuts.open-preview-terminal',
          defaultLabel: 'Open Terminal in Preview',
          keys: [primary, shift, 'T'],
        },
        {
          id: 'toggle-session-side-panel',
          labelKey: 'layout.shortcuts.toggle-session-side-panel',
          defaultLabel: 'Toggle Session Side Panel',
          keys: [primary, shift, 'E'],
        },
      ],
    },
    {
      id: 'editing',
      labelKey: 'layout.shortcuts.group-editing',
      defaultLabel: 'Editing',
      shortcuts: [
        {
          id: 'undo',
          labelKey: 'layout.shortcuts.undo',
          defaultLabel: 'Undo',
          keys: [primary, 'Z'],
        },
        {
          id: 'redo',
          labelKey: 'layout.shortcuts.redo',
          defaultLabel: 'Redo',
          keys: platform === 'win32' ? [primary, 'Y'] : [primary, shift, 'Z'],
        },
        {
          id: 'cut',
          labelKey: 'layout.shortcuts.cut',
          defaultLabel: 'Cut',
          keys: [primary, 'X'],
        },
        {
          id: 'copy',
          labelKey: 'layout.shortcuts.copy',
          defaultLabel: 'Copy',
          keys: [primary, 'C'],
        },
        {
          id: 'paste',
          labelKey: 'layout.shortcuts.paste',
          defaultLabel: 'Paste',
          keys: [primary, 'V'],
        },
        {
          id: 'paste-match-style',
          labelKey: 'layout.shortcuts.paste-match-style',
          defaultLabel: 'Paste and Match Style',
          keys: [primary, shift, 'V'],
        },
        {
          id: 'select-all',
          labelKey: 'layout.shortcuts.select-all',
          defaultLabel: 'Select All',
          keys: [primary, 'A'],
        },
      ],
    },
    {
      id: 'window',
      labelKey: 'layout.shortcuts.group-window',
      defaultLabel: 'Window',
      shortcuts: [
        {
          id: 'close-window',
          labelKey: 'layout.shortcuts.close-window',
          defaultLabel: 'Close Window',
          keys: [primary, 'W'],
        },
        {
          id: 'full-screen',
          labelKey: 'layout.shortcuts.full-screen',
          defaultLabel: 'Toggle Full Screen',
          keys: isMac ? ['⌃', '⌘', 'F'] : ['F11'],
        },
        ...(isMac
          ? [
              {
                id: 'minimize',
                labelKey: 'layout.shortcuts.minimize',
                defaultLabel: 'Minimize',
                keys: ['⌘', 'M'],
              },
              {
                id: 'quit',
                labelKey: 'layout.shortcuts.quit',
                defaultLabel: 'Quit Eigent',
                keys: ['⌘', 'Q'],
              },
            ]
          : []),
      ],
    },
  ];
}

export function getKeyboardShortcutById(
  platform: DesktopShortcutPlatform,
  shortcutId: string
): KeyboardShortcutItem | undefined {
  return getKeyboardShortcutGroups(platform)
    .flatMap((group) => group.shortcuts)
    .find((shortcut) => shortcut.id === shortcutId);
}

export function formatKeyboardShortcutKeys(keys: readonly string[]): string {
  return keys.some((key) => key === '⌘' || key === '⌃' || key === '⇧')
    ? keys.join('')
    : keys.join('+');
}
