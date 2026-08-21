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

export type ContextMenuSurfaceKind =
  | 'main-renderer'
  | 'preview-guest'
  | 'automation-view';

export type ContextMenuWebContents = Pick<
  Electron.WebContents,
  | 'copy'
  | 'cut'
  | 'inspectElement'
  | 'isDestroyed'
  | 'off'
  | 'on'
  | 'paste'
  | 'redo'
  | 'selectAll'
  | 'undo'
>;

export interface ContextMenuPopup {
  popup: (options: Electron.PopupOptions) => void;
}

export interface ContextMenuApi<
  TMenu extends ContextMenuPopup = ContextMenuPopup,
> {
  buildFromTemplate: (template: Electron.MenuItemConstructorOptions[]) => TMenu;
}

export interface ContextMenuTemplateOptions {
  contents: ContextMenuWebContents;
  isDevelopment: boolean;
  params: Pick<
    Electron.ContextMenuParams,
    'editFlags' | 'isEditable' | 'menuSourceType' | 'x' | 'y'
  >;
  surfaceKind: ContextMenuSurfaceKind;
}

export interface InstallContextMenuOptions<
  TMenu extends ContextMenuPopup = ContextMenuPopup,
> {
  contents: ContextMenuWebContents;
  isDevelopment: boolean;
  menuApi: ContextMenuApi<TMenu>;
  ownerWindow: Electron.BaseWindow;
  surfaceKind: ContextMenuSurfaceKind;
}

type ContextCommand =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'select-all'
  | 'inspect';

function commandItem(
  surfaceKind: ContextMenuSurfaceKind,
  command: ContextCommand,
  label: string,
  enabled: boolean,
  click: () => void
): Electron.MenuItemConstructorOptions {
  return {
    id: `context.${surfaceKind}.${command}`,
    label,
    enabled,
    click,
  };
}

const separator = (): Electron.MenuItemConstructorOptions => ({
  type: 'separator',
});

/**
 * Build a fresh template for one invocation. Every action closes over the exact
 * WebContents that emitted the event; focus changes while the native menu is
 * open cannot redirect editing into another surface.
 */
export function buildContextMenuTemplate({
  contents,
  isDevelopment,
  params,
  surfaceKind,
}: ContextMenuTemplateOptions): Electron.MenuItemConstructorOptions[] {
  const { editFlags } = params;
  const supportsEditing =
    surfaceKind !== 'automation-view' && params.isEditable;
  const template: Electron.MenuItemConstructorOptions[] = supportsEditing
    ? [
        commandItem(surfaceKind, 'undo', 'Undo', editFlags.canUndo, () =>
          contents.undo()
        ),
        commandItem(surfaceKind, 'redo', 'Redo', editFlags.canRedo, () =>
          contents.redo()
        ),
        separator(),
        commandItem(surfaceKind, 'cut', 'Cut', editFlags.canCut, () =>
          contents.cut()
        ),
        commandItem(surfaceKind, 'copy', 'Copy', editFlags.canCopy, () =>
          contents.copy()
        ),
        commandItem(surfaceKind, 'paste', 'Paste', editFlags.canPaste, () =>
          contents.paste()
        ),
        separator(),
        commandItem(
          surfaceKind,
          'select-all',
          'Select All',
          editFlags.canSelectAll,
          () => contents.selectAll()
        ),
      ]
    : [
        commandItem(surfaceKind, 'copy', 'Copy', editFlags.canCopy, () =>
          contents.copy()
        ),
        commandItem(
          surfaceKind,
          'select-all',
          'Select All',
          editFlags.canSelectAll,
          () => contents.selectAll()
        ),
      ];

  if (isDevelopment && surfaceKind !== 'automation-view') {
    template.push(
      separator(),
      commandItem(
        surfaceKind,
        'inspect',
        'Inspect Element',
        !contents.isDestroyed(),
        () => contents.inspectElement(params.x, params.y)
      )
    );
  }

  return template;
}

/** Attach a native context menu and return an idempotent listener disposer. */
export function installContextMenu<
  TMenu extends ContextMenuPopup = ContextMenuPopup,
>({
  contents,
  isDevelopment,
  menuApi,
  ownerWindow,
  surfaceKind,
}: InstallContextMenuOptions<TMenu>): () => void {
  const listener = (
    _event: Electron.Event,
    params: Electron.ContextMenuParams
  ) => {
    if (contents.isDestroyed()) return;

    const menu = menuApi.buildFromTemplate(
      buildContextMenuTemplate({
        contents,
        isDevelopment,
        params,
        surfaceKind,
      })
    );
    menu.popup({
      window: ownerWindow,
      sourceType: params.menuSourceType,
    });
  };

  contents.on('context-menu', listener);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (!contents.isDestroyed()) contents.off('context-menu', listener);
  };
}
