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
      sessionPreviewOpen: false,
      sessionPreviewTabs: [],
      activeSessionPreviewTabId: null,
    });
  });

  it('seeds browser and file tabs when the unified preview opens', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();

    const state = usePageTabStore.getState();
    expect(state.sessionPreviewOpen).toBe(true);
    expect(state.sessionPreviewTabs.map((tab) => tab.type)).toEqual([
      'browser',
      'file',
    ]);
    expect(state.sessionPreviewTabs.map((tab) => tab.title)).toEqual([
      'New tab',
      'Open file',
    ]);
    expect(state.activeSessionPreviewTabId).toBe(
      state.sessionPreviewTabs[0].id
    );
  });

  it('adds and selects blank browser and file tabs', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    store.addBrowserPreviewTab();

    let state = usePageTabStore.getState();
    expect(state.sessionPreviewTabs).toHaveLength(3);
    let active = state.sessionPreviewTabs.find(
      (tab) => tab.id === state.activeSessionPreviewTabId
    );
    expect(active).toMatchObject({
      type: 'browser',
      title: 'New tab',
      url: '',
    });

    store.addFilePreviewTab();
    state = usePageTabStore.getState();
    active = state.sessionPreviewTabs.find(
      (tab) => tab.id === state.activeSessionPreviewTabId
    );
    expect(active).toMatchObject({
      type: 'file',
      title: 'Open file',
      file: null,
    });
  });

  it('reuses the empty file tab and deduplicates files by path', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
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
    expect(usePageTabStore.getState().sessionPreviewTabs).toHaveLength(2);

    store.resetSessionPreview();
    expect(usePageTabStore.getState()).toMatchObject({
      sessionPreviewOpen: false,
      sessionPreviewTabs: [],
      activeSessionPreviewTabId: null,
    });
  });
});
