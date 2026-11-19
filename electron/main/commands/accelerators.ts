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

export type DesktopMenuPlatform = 'darwin' | 'win32' | 'linux';

export interface InstalledAccelerator {
  accelerator: string;
  command: string;
  normalized: string;
}

const MODIFIER_ORDER = ['Command', 'Control', 'Alt', 'Shift', 'Super'] as const;

const RENDERER_RESERVED_KEYS = ['K', 'S'] as const;

/**
 * Keys the embedded xterm terminal must receive verbatim on Windows and Linux,
 * where the app modifier is Ctrl and these are standard readline bindings
 * (Ctrl+N next-history, Ctrl+B backward-char, Ctrl+W backward-kill-word).
 * Their menu items keep the conventional label but must not register the
 * accelerator, exactly like the Edit roles; the renderer dispatches them
 * instead and lets the terminal win.
 * macOS is unaffected: there the app modifier is Command, which the shell
 * never claims.
 */
const TERMINAL_OWNED_NON_MAC_KEYS = ['N', 'B', 'W'] as const;

/** True when the renderer, not the native menu, must own this accelerator. */
export function isTerminalOwnedAccelerator(
  key: string,
  platform: DesktopMenuPlatform
): boolean {
  if (platform === 'darwin') return false;
  return (TERMINAL_OWNED_NON_MAC_KEYS as readonly string[]).includes(
    key.toUpperCase()
  );
}

/**
 * Renderer-owned shortcuts that a native menu must not register. Copy and the
 * other edit accelerators are handled separately: Windows/Linux display them
 * in the menu with `registerAccelerator: false`, while macOS requires native
 * Edit accelerators for standard text editing.
 */
export function getReservedRendererAccelerators(
  platform: DesktopMenuPlatform
): string[] {
  const modifier = platform === 'darwin' ? 'Command' : 'Control';
  return RENDERER_RESERVED_KEYS.map((key) => `${modifier}+${key}`);
}

function normalizeModifier(
  token: string,
  platform: DesktopMenuPlatform
): (typeof MODIFIER_ORDER)[number] | null {
  switch (token.toLowerCase()) {
    case 'cmd':
    case 'command':
    case 'meta':
      return 'Command';
    case 'ctrl':
    case 'control':
      return 'Control';
    case 'cmdorctrl':
    case 'commandorcontrol':
      return platform === 'darwin' ? 'Command' : 'Control';
    case 'alt':
    case 'option':
      return 'Alt';
    case 'shift':
      return 'Shift';
    case 'super':
      return 'Super';
    default:
      return null;
  }
}

function normalizeKey(token: string): string {
  if (token.length === 1 && /[a-z]/i.test(token)) return token.toUpperCase();
  if (/^f\d+$/i.test(token)) return token.toUpperCase();

  switch (token.toLowerCase()) {
    case 'plus':
      return 'Plus';
    case 'space':
      return 'Space';
    case 'tab':
      return 'Tab';
    case 'enter':
    case 'return':
      return 'Enter';
    case 'escape':
    case 'esc':
      return 'Escape';
    default:
      return token;
  }
}

/** Resolve aliases and modifier ordering so equivalent accelerators compare. */
export function normalizeAccelerator(
  accelerator: string,
  platform: DesktopMenuPlatform
): string {
  const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
  const keys: string[] = [];

  for (const rawToken of accelerator.split('+')) {
    const token = rawToken.trim();
    if (!token) continue;
    const modifier = normalizeModifier(token, platform);
    if (modifier) modifiers.add(modifier);
    else keys.push(normalizeKey(token));
  }

  return [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    ...keys,
  ].join('+');
}

function submenuItems(
  item: Electron.MenuItemConstructorOptions
): Electron.MenuItemConstructorOptions[] {
  return Array.isArray(item.submenu) ? item.submenu : [];
}

/** Collect accelerators that Electron will actually register for this menu. */
export function collectInstalledAccelerators(
  template: Electron.MenuItemConstructorOptions[],
  platform: DesktopMenuPlatform
): InstalledAccelerator[] {
  const installed: InstalledAccelerator[] = [];

  const visit = (
    items: Electron.MenuItemConstructorOptions[],
    parentPath: string[]
  ) => {
    for (const item of items) {
      const command =
        item.id ||
        [...parentPath, item.label || item.role || 'menu-item'].join('/');

      if (
        item.accelerator &&
        !(platform !== 'darwin' && item.registerAccelerator === false)
      ) {
        installed.push({
          accelerator: item.accelerator,
          command,
          normalized: normalizeAccelerator(item.accelerator, platform),
        });
      }

      const children = submenuItems(item);
      if (children.length > 0) {
        visit(children, [...parentPath, item.label || item.role || 'menu']);
      }
    }
  };

  visit(template, []);
  return installed;
}

/** Fail fast before Electron installs an ambiguous or renderer-owned shortcut. */
export function assertUniqueInstalledAccelerators(
  template: Electron.MenuItemConstructorOptions[],
  platform: DesktopMenuPlatform,
  reservedAccelerators = getReservedRendererAccelerators(platform)
): void {
  const reserved = new Set(
    reservedAccelerators.map((accelerator) =>
      normalizeAccelerator(accelerator, platform)
    )
  );
  const seen = new Map<string, InstalledAccelerator>();

  for (const installed of collectInstalledAccelerators(template, platform)) {
    if (reserved.has(installed.normalized)) {
      throw new Error(
        `Native menu command "${installed.command}" conflicts with renderer-reserved accelerator ${installed.accelerator}`
      );
    }

    const existing = seen.get(installed.normalized);
    if (existing) {
      throw new Error(
        `Native menu accelerator ${installed.accelerator} is assigned to both "${existing.command}" and "${installed.command}"`
      );
    }
    seen.set(installed.normalized, installed);
  }
}
