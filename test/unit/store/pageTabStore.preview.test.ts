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

import { usePageTabStore } from '@/store/pageTabStore';
import { beforeEach, describe, expect, it } from 'vitest';

describe('pageTabStore session preview', () => {
  beforeEach(() => {
    usePageTabStore.setState({
      sessionPreviewProjectId: null,
      sessionPreviewByProject: {},
      sessionPreviewOpen: false,
      sessionPreviewTabs: [],
      activeSessionPreviewTabId: null,
    });
  });

  it('opens onto a single chooser tab', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();

    const state = usePageTabStore.getState();
    expect(state.sessionPreviewOpen).toBe(true);
    expect(state.sessionPreviewTabs.map((tab) => tab.type)).toEqual([
      'chooser',
    ]);
    expect(state.activeSessionPreviewTabId).toBe(
      state.sessionPreviewTabs[0].id
    );
  });

  it('turns the chooser into the chosen content kind in place', () => {
    const store = usePageTabStore.getState();
    store.setSessionPreviewProject('project-a');
    store.toggleSessionPreview();
    const chooserId = usePageTabStore.getState().sessionPreviewTabs[0].id;

    store.choosePreviewTabType(chooserId, 'browser');
    let state = usePageTabStore.getState();
    expect(state.sessionPreviewTabs).toHaveLength(1);
    const browser = state.sessionPreviewTabs[0];
    expect(browser.type).toBe('browser');
    expect(state.activeSessionPreviewTabId).toBe(browser.id);
    expect(browser.type === 'browser' && browser.webviewId).toContain(
      'session-preview:project-a:'
    );

    // A new chooser (via "+") can become other kinds too.
    store.addChooserPreviewTab();
    const newChooserId = usePageTabStore.getState().activeSessionPreviewTabId!;
    store.choosePreviewTabType(newChooserId, 'canvas');
    state = usePageTabStore.getState();
    expect(state.sessionPreviewTabs.map((tab) => tab.type)).toEqual([
      'browser',
      'canvas',
    ]);
  });

  it('exposes every content kind via choosePreviewTabType', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    (['file', 'review', 'terminal', 'canvas'] as const).forEach((kind) => {
      store.addChooserPreviewTab();
      const id = usePageTabStore.getState().activeSessionPreviewTabId!;
      store.choosePreviewTabType(id, kind);
      const active = usePageTabStore
        .getState()
        .sessionPreviewTabs.find(
          (tab) =>
            tab.id === usePageTabStore.getState().activeSessionPreviewTabId
        );
      expect(active?.type).toBe(kind);
    });
  });

  it('reuses the chooser tab when a file is opened', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const file = { name: 'doc.txt', path: '/tmp/doc.txt' } as FileInfo;
    store.openFilePreview(file);

    const state = usePageTabStore.getState();
    // Chooser replaced in place — no extra tab piled up.
    expect(state.sessionPreviewTabs).toHaveLength(1);
    expect(state.sessionPreviewTabs[0]).toMatchObject({
      type: 'file',
      title: 'doc.txt',
      file,
    });
  });

  it('reuses the empty file tab and deduplicates files by path', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const chooserId = usePageTabStore.getState().sessionPreviewTabs[0].id;
    store.choosePreviewTabType(chooserId, 'file');

    const file = { name: 'doc.txt', path: '/tmp/doc.txt' } as FileInfo;
    store.openFilePreview(file);
    store.openFilePreview({ ...file });

    const state = usePageTabStore.getState();
    const fileTabs = state.sessionPreviewTabs.filter(
      (tab) => tab.type === 'file'
    );
    expect(fileTabs).toHaveLength(1);
    expect(fileTabs[0]).toMatchObject({ title: 'doc.txt', file });
    expect(state.activeSessionPreviewTabId).toBe(fileTabs[0].id);
  });

  it('selects a neighboring tab and closes the panel after the final tab', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const chooserId = usePageTabStore.getState().sessionPreviewTabs[0].id;
    store.choosePreviewTabType(chooserId, 'browser');
    store.addChooserPreviewTab();
    store.choosePreviewTabType(
      usePageTabStore.getState().activeSessionPreviewTabId!,
      'file'
    );
    const [browserTab, fileTab] = usePageTabStore.getState().sessionPreviewTabs;

    store.closeSessionPreviewTab(browserTab.id);
    expect(usePageTabStore.getState().activeSessionPreviewTabId).toBe(
      fileTab.id
    );

    store.closeSessionPreviewTab(fileTab.id);
    expect(usePageTabStore.getState()).toMatchObject({
      sessionPreviewOpen: false,
      sessionPreviewTabs: [],
      activeSessionPreviewTabId: null,
    });
  });

  it('closes without discarding tabs and resets project-scoped state', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    store.closeSessionPreview();
    expect(usePageTabStore.getState().sessionPreviewTabs).toHaveLength(1);

    store.resetSessionPreview();
    expect(usePageTabStore.getState()).toMatchObject({
      sessionPreviewOpen: false,
      sessionPreviewTabs: [],
      activeSessionPreviewTabId: null,
    });
  });

  it('keeps preview state per project and restores it on switch-back', () => {
    const store = usePageTabStore.getState();
    store.setSessionPreviewProject('project-a');
    store.toggleSessionPreview();
    const projectATabs = usePageTabStore.getState().sessionPreviewTabs;
    expect(projectATabs).toHaveLength(1);

    // Switching projects swaps in the other project's (empty) slice…
    store.setSessionPreviewProject('project-b');
    expect(usePageTabStore.getState()).toMatchObject({
      sessionPreviewOpen: false,
      sessionPreviewTabs: [],
      activeSessionPreviewTabId: null,
    });

    // …and switching back restores tabs, active tab, and the open flag.
    store.setSessionPreviewProject('project-a');
    const restored = usePageTabStore.getState();
    expect(restored.sessionPreviewOpen).toBe(true);
    expect(restored.sessionPreviewTabs).toEqual(projectATabs);
    expect(restored.activeSessionPreviewTabId).toBe(projectATabs[0].id);
  });

  it('records mutations into the per-project slice for persistence', () => {
    const store = usePageTabStore.getState();
    store.setSessionPreviewProject('project-a');
    store.toggleSessionPreview();
    const file = { name: 'doc.txt', path: '/tmp/doc.txt' } as FileInfo;
    store.openFilePreview(file);

    const slice =
      usePageTabStore.getState().sessionPreviewByProject['project-a'];
    expect(slice.open).toBe(true);
    expect(
      slice.tabs.filter((tab) => tab.type === 'file' && tab.file !== null)
    ).toHaveLength(1);
    expect(slice.activeTabId).toBe(
      usePageTabStore.getState().activeSessionPreviewTabId
    );
  });
});
