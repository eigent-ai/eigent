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
  buildContextMenuTemplate,
  installContextMenu,
  type ContextMenuTemplateOptions,
  type ContextMenuWebContents,
} from '../../../electron/main/commands/contextMenu';
import { getNativeMenuMessages } from '../../../electron/main/commands/nativeMenuMessages';

type MenuItem = Electron.MenuItemConstructorOptions;
const englishMessages = getNativeMenuMessages('en-US');

function createContents(destroyed = false) {
  const methods = {
    copy: vi.fn(),
    cut: vi.fn(),
    inspectElement: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    off: vi.fn(),
    on: vi.fn(),
    paste: vi.fn(),
    redo: vi.fn(),
    selectAll: vi.fn(),
    undo: vi.fn(),
  };
  return {
    contents: methods as unknown as ContextMenuWebContents,
    methods,
  };
}

function createParams(
  overrides: Partial<ContextMenuTemplateOptions['params']> = {}
): ContextMenuTemplateOptions['params'] {
  return {
    editFlags: {
      canUndo: true,
      canRedo: false,
      canCut: true,
      canCopy: false,
      canPaste: true,
      canDelete: false,
      canSelectAll: true,
      canEditRichly: false,
    },
    isEditable: true,
    menuSourceType: 'mouse',
    x: 17,
    y: 29,
    ...overrides,
  };
}

function itemNames(template: MenuItem[]): string[] {
  return template.map((item) =>
    item.type === 'separator' ? 'separator' : String(item.label)
  );
}

function findByLabel(template: MenuItem[], label: string): MenuItem {
  const item = template.find((candidate) => candidate.label === label);
  if (!item) throw new Error(`Missing context menu item ${label}`);
  return item;
}

function click(item: MenuItem): void {
  item.click?.({} as never, undefined, {} as never);
}

describe('context menu', () => {
  it('builds conventional editable commands with exact enabled flags and target operations', () => {
    const { contents, methods } = createContents();
    const template = buildContextMenuTemplate({
      contents,
      isDevelopment: true,
      messages: englishMessages,
      params: createParams(),
      surfaceKind: 'main-renderer',
    });

    expect(itemNames(template)).toEqual([
      'Undo',
      'Redo',
      'separator',
      'Cut',
      'Copy',
      'Paste',
      'separator',
      'Select All',
      'separator',
      'Inspect Element',
    ]);
    expect(findByLabel(template, 'Undo').enabled).toBe(true);
    expect(findByLabel(template, 'Redo').enabled).toBe(false);
    expect(findByLabel(template, 'Cut').enabled).toBe(true);
    expect(findByLabel(template, 'Copy').enabled).toBe(false);
    expect(findByLabel(template, 'Paste').enabled).toBe(true);
    expect(findByLabel(template, 'Select All').enabled).toBe(true);

    for (const label of [
      'Undo',
      'Redo',
      'Cut',
      'Copy',
      'Paste',
      'Select All',
      'Inspect Element',
    ]) {
      click(findByLabel(template, label));
    }

    expect(methods.undo).toHaveBeenCalledOnce();
    expect(methods.redo).toHaveBeenCalledOnce();
    expect(methods.cut).toHaveBeenCalledOnce();
    expect(methods.copy).toHaveBeenCalledOnce();
    expect(methods.paste).toHaveBeenCalledOnce();
    expect(methods.selectAll).toHaveBeenCalledOnce();
    expect(methods.inspectElement).toHaveBeenCalledWith(17, 29);
  });

  it('uses only Copy and Select All in read-only content and hides Inspect in production', () => {
    const { contents } = createContents();
    const template = buildContextMenuTemplate({
      contents,
      isDevelopment: false,
      messages: englishMessages,
      params: createParams({
        isEditable: false,
        editFlags: {
          ...createParams().editFlags,
          canCopy: true,
          canSelectAll: false,
        },
      }),
      surfaceKind: 'preview-guest',
    });

    expect(itemNames(template)).toEqual(['Copy', 'Select All']);
    expect(findByLabel(template, 'Copy').enabled).toBe(true);
    expect(findByLabel(template, 'Select All').enabled).toBe(false);
    expect(template.every((item) => item.role === undefined)).toBe(true);
  });

  it('keeps automation views read-only and without Inspect even in development', () => {
    const { contents, methods } = createContents();
    const template = buildContextMenuTemplate({
      contents,
      isDevelopment: true,
      messages: englishMessages,
      params: createParams({ isEditable: true }),
      surfaceKind: 'automation-view',
    });

    expect(itemNames(template)).toEqual(['Copy', 'Select All']);
    click(findByLabel(template, 'Copy'));
    click(findByLabel(template, 'Select All'));
    expect(methods.copy).toHaveBeenCalledOnce();
    expect(methods.selectAll).toHaveBeenCalledOnce();
    expect(methods.undo).not.toHaveBeenCalled();
    expect(methods.redo).not.toHaveBeenCalled();
    expect(methods.cut).not.toHaveBeenCalled();
    expect(methods.paste).not.toHaveBeenCalled();
    expect(methods.inspectElement).not.toHaveBeenCalled();
  });

  it.each(['main-renderer', 'preview-guest', 'automation-view'] as const)(
    'identifies commands from the %s surface',
    (surfaceKind) => {
      const { contents } = createContents();
      const template = buildContextMenuTemplate({
        contents,
        isDevelopment: false,
        messages: englishMessages,
        params: createParams({ isEditable: false }),
        surfaceKind,
      });

      expect(
        template
          .filter((item) => item.type !== 'separator')
          .every((item) => item.id?.startsWith(`context.${surfaceKind}.`))
      ).toBe(true);
    }
  );

  it('pops up against the owner and source type without forwarding content coordinates', () => {
    let listener:
      | ((_event: Electron.Event, params: Electron.ContextMenuParams) => void)
      | undefined;
    const first = createContents();
    const second = createContents();
    first.methods.on.mockImplementation((_event, nextListener) => {
      listener = nextListener;
      return first.contents;
    });
    const popup = vi.fn();
    const builtTemplates: Electron.MenuItemConstructorOptions[][] = [];
    const buildFromTemplate = vi.fn(
      (template: Electron.MenuItemConstructorOptions[]) => {
        builtTemplates.push(template);
        return { popup };
      }
    );
    const ownerWindow = {
      id: 'owner-window',
    } as unknown as Electron.BaseWindow;

    const dispose = installContextMenu({
      contents: first.contents,
      getMessages: () => englishMessages,
      isDevelopment: true,
      menuApi: { buildFromTemplate },
      ownerWindow,
      surfaceKind: 'automation-view',
    });

    expect(first.methods.on).toHaveBeenCalledWith(
      'context-menu',
      expect.any(Function)
    );
    listener?.(
      {} as Electron.Event,
      createParams({ menuSourceType: 'keyboard' }) as Electron.ContextMenuParams
    );

    expect(buildFromTemplate).toHaveBeenCalledOnce();
    expect(popup).toHaveBeenCalledWith({
      window: ownerWindow,
      sourceType: 'keyboard',
    });
    const builtTemplate = builtTemplates[0];
    expect(builtTemplate).toBeDefined();
    if (!builtTemplate) throw new Error('Expected a built context menu');
    click(findByLabel(builtTemplate, 'Copy'));
    expect(first.methods.copy).toHaveBeenCalledOnce();
    expect(second.methods.copy).not.toHaveBeenCalled();

    dispose();
    dispose();
    expect(first.methods.off).toHaveBeenCalledOnce();
    expect(first.methods.off).toHaveBeenCalledWith(
      'context-menu',
      expect.any(Function)
    );
  });

  it('does not build or show a menu after its WebContents is destroyed', () => {
    let listener:
      | ((_event: Electron.Event, params: Electron.ContextMenuParams) => void)
      | undefined;
    const { contents, methods } = createContents(true);
    methods.on.mockImplementation((_event, nextListener) => {
      listener = nextListener;
      return contents;
    });
    const buildFromTemplate = vi.fn();

    installContextMenu({
      contents,
      getMessages: () => englishMessages,
      isDevelopment: true,
      menuApi: { buildFromTemplate },
      ownerWindow: {} as Electron.BaseWindow,
      surfaceKind: 'main-renderer',
    });
    listener?.(
      {} as Electron.Event,
      createParams() as Electron.ContextMenuParams
    );

    expect(buildFromTemplate).not.toHaveBeenCalled();
  });

  it('reads the latest locale catalog for each popup', () => {
    let listener:
      | ((_event: Electron.Event, params: Electron.ContextMenuParams) => void)
      | undefined;
    const { contents, methods } = createContents();
    methods.on.mockImplementation((_event, nextListener) => {
      listener = nextListener;
      return contents;
    });
    let messages = englishMessages;
    const builtTemplates: Electron.MenuItemConstructorOptions[][] = [];
    installContextMenu({
      contents,
      getMessages: () => messages,
      isDevelopment: false,
      menuApi: {
        buildFromTemplate: (template) => {
          builtTemplates.push(template);
          return { popup: vi.fn() };
        },
      },
      ownerWindow: {} as Electron.BaseWindow,
      surfaceKind: 'main-renderer',
    });

    listener?.(
      {} as Electron.Event,
      createParams() as Electron.ContextMenuParams
    );
    messages = getNativeMenuMessages('zh-Hans');
    listener?.(
      {} as Electron.Event,
      createParams() as Electron.ContextMenuParams
    );

    expect(itemNames(builtTemplates[0] ?? [])).toContain('Undo');
    expect(itemNames(builtTemplates[1] ?? [])).toContain('撤销');
  });
});
