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

import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { beforeEach, describe, expect, it } from 'vitest';

/** The preview slice for the currently scoped project. */
function slice() {
  return getSessionPreviewSlice(usePageTabStore.getState());
}

describe('pageTabStore session preview', () => {
  beforeEach(() => {
    usePageTabStore.setState({
      sessionPreviewProjectId: null,
      sessionPreviewByProject: {},
    });
    usePageTabStore.getState().setSessionPreviewProject('project-a');
  });

  it('opens onto a single chooser tab', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();

    expect(slice().open).toBe(true);
    expect(slice().tabs.map((tab) => tab.type)).toEqual(['chooser']);
    expect(slice().activeTabId).toBe(slice().tabs[0].id);
  });

  it('drops mutations when no project is scoped', () => {
    const store = usePageTabStore.getState();
    store.setSessionPreviewProject(null);
    store.toggleSessionPreview();

    expect(slice()).toMatchObject({ open: false, tabs: [] });
    expect(usePageTabStore.getState().sessionPreviewByProject).toEqual({});
  });

  it('turns the chooser into the chosen content kind in place', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const chooserId = slice().tabs[0].id;

    store.choosePreviewTabType(chooserId, 'browser');
    expect(slice().tabs).toHaveLength(1);
    const browser = slice().tabs[0];
    expect(browser.type).toBe('browser');
    expect(slice().activeTabId).toBe(browser.id);
    expect(browser.type === 'browser' && browser.webviewId).toContain(
      'session-preview:project-a:'
    );

    // A new chooser (via "+") can become other kinds too.
    store.addChooserPreviewTab();
    const newChooserId = slice().activeTabId!;
    store.choosePreviewTabType(newChooserId, 'canvas');
    expect(slice().tabs.map((tab) => tab.type)).toEqual(['browser', 'canvas']);
  });

  it('exposes every content kind via choosePreviewTabType', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    (['file', 'review', 'terminal', 'canvas'] as const).forEach((kind) => {
      store.addChooserPreviewTab();
      const id = slice().activeTabId!;
      store.choosePreviewTabType(id, kind);
      const active = slice().tabs.find((tab) => tab.id === slice().activeTabId);
      expect(active?.type).toBe(kind);
    });
  });

  it('reuses the chooser tab when a file is opened', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const file = { name: 'doc.txt', path: '/tmp/doc.txt' } as FileInfo;
    store.openFilePreview(file);

    // Chooser replaced in place — no extra tab piled up.
    expect(slice().tabs).toHaveLength(1);
    expect(slice().tabs[0]).toMatchObject({
      type: 'file',
      title: 'doc.txt',
      file,
    });
  });

  it('reuses the empty file tab and deduplicates files by path', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const chooserId = slice().tabs[0].id;
    store.choosePreviewTabType(chooserId, 'file');

    const file = { name: 'doc.txt', path: '/tmp/doc.txt' } as FileInfo;
    store.openFilePreview(file);
    store.openFilePreview({ ...file });

    const fileTabs = slice().tabs.filter((tab) => tab.type === 'file');
    expect(fileTabs).toHaveLength(1);
    expect(fileTabs[0]).toMatchObject({ title: 'doc.txt', file });
    expect(slice().activeTabId).toBe(fileTabs[0].id);
  });

  it('opens chat links in a browser tab of the current project preview', () => {
    const store = usePageTabStore.getState();
    store.openBrowserPreview('https://example.com/docs');

    expect(slice().open).toBe(true);
    expect(slice().tabs).toHaveLength(1);
    expect(slice().tabs[0]).toMatchObject({
      type: 'browser',
      url: 'https://example.com/docs',
      title: 'example.com',
    });
    expect(slice().activeTabId).toBe(slice().tabs[0].id);

    // Invalid destinations are ignored.
    store.openBrowserPreview('javascript:alert(1)');
    expect(slice().tabs).toHaveLength(1);
  });

  it('reuses the chooser and deduplicates browser tabs by URL', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    store.openBrowserPreview('https://example.com/docs');

    // Chooser replaced in place — no extra tab piled up.
    expect(slice().tabs).toHaveLength(1);
    expect(slice().tabs[0].type).toBe('browser');

    // The same URL (modulo trailing slash) focuses the existing tab…
    store.openBrowserPreview('https://example.com/docs/');
    expect(slice().tabs).toHaveLength(1);

    // …while a different URL opens alongside it.
    store.openBrowserPreview('https://other.example.com');
    expect(slice().tabs).toHaveLength(2);
    expect(slice().activeTabId).toBe(slice().tabs[1].id);
  });

  it('selects a neighboring tab and closes the panel after the final tab', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const chooserId = slice().tabs[0].id;
    store.choosePreviewTabType(chooserId, 'browser');
    store.addChooserPreviewTab();
    store.choosePreviewTabType(slice().activeTabId!, 'file');
    const [browserTab, fileTab] = slice().tabs;

    store.closeSessionPreviewTab(browserTab.id);
    expect(slice().activeTabId).toBe(fileTab.id);

    store.closeSessionPreviewTab(fileTab.id);
    expect(slice()).toMatchObject({
      open: false,
      tabs: [],
      activeTabId: null,
    });
  });

  it('closes without discarding tabs and resets project-scoped state', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    store.closeSessionPreview();
    expect(slice().open).toBe(false);
    expect(slice().tabs).toHaveLength(1);

    store.resetSessionPreview();
    expect(slice()).toMatchObject({
      open: false,
      tabs: [],
      activeTabId: null,
    });
  });

  it('keeps preview state per project and restores it on switch-back', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const projectATabs = slice().tabs;
    expect(projectATabs).toHaveLength(1);

    // Switching projects swaps in the other project's (empty) slice…
    store.setSessionPreviewProject('project-b');
    expect(slice()).toMatchObject({
      open: false,
      tabs: [],
      activeTabId: null,
    });

    // …and switching back restores tabs, active tab, and the open flag.
    store.setSessionPreviewProject('project-a');
    expect(slice().open).toBe(true);
    expect(slice().tabs).toEqual(projectATabs);
    expect(slice().activeTabId).toBe(projectATabs[0].id);
  });

  it('records mutations into the per-project slice for persistence', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const file = { name: 'doc.txt', path: '/tmp/doc.txt' } as FileInfo;
    store.openFilePreview(file);

    const persisted =
      usePageTabStore.getState().sessionPreviewByProject['project-a'];
    expect(persisted.open).toBe(true);
    expect(
      persisted.tabs.filter((tab) => tab.type === 'file' && tab.file !== null)
    ).toHaveLength(1);
    expect(persisted.activeTabId).toBe(slice().activeTabId);
  });
});
