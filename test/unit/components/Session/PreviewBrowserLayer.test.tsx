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

import { PreviewBrowserLayer } from '@/components/Session/PreviewPanel/tabs/browser/PreviewBrowserLayer';
import { getPreviewWebview } from '@/components/Session/PreviewPanel/tabs/browser/webviewRegistry';
import { HostProvider } from '@/host';
import { usePageTabStore } from '@/store/pageTabStore';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

const host = { ipcRenderer: null, electronAPI: {} };

function renderLayer() {
  return render(
    <HostProvider host={host}>
      <PreviewBrowserLayer />
    </HostProvider>
  );
}

function getBrowserTab() {
  const tab = usePageTabStore
    .getState()
    .sessionPreviewTabs.find((candidate) => candidate.type === 'browser');
  if (!tab || tab.type !== 'browser') throw new Error('missing browser tab');
  return tab;
}

function guestContainer(webviewId: string): HTMLElement | null {
  return document.querySelector(`[data-preview-webview-id="${webviewId}"]`);
}

describe('PreviewBrowserLayer', () => {
  beforeEach(() => {
    usePageTabStore.setState({
      sessionPreviewProjectId: null,
      sessionPreviewByProject: {},
      sessionPreviewOpen: false,
      sessionPreviewTabs: [],
      activeSessionPreviewTabId: null,
      previewBrowserViewport: null,
    });
    usePageTabStore.getState().setSessionPreviewProject('project-a');
    usePageTabStore.getState().toggleSessionPreview();
    // Turn the seeded chooser tab into a browser tab for these tests.
    const chooserId = usePageTabStore.getState().sessionPreviewTabs[0].id;
    usePageTabStore.getState().choosePreviewTabType(chooserId, 'browser');
  });

  it('mounts a <webview> guest once a browser tab has a URL', () => {
    renderLayer();
    const tab = getBrowserTab();
    expect(guestContainer(tab.webviewId)).toBeNull();

    act(() => {
      usePageTabStore
        .getState()
        .updateBrowserPreviewTab(tab.id, { url: 'https://example.com/' });
    });

    const container = guestContainer(tab.webviewId);
    expect(container).not.toBeNull();
    const webview = container!.querySelector('webview');
    expect(webview).not.toBeNull();
    expect(webview!.getAttribute('src')).toBe('https://example.com/');
    expect(webview!.getAttribute('partition')).toBe('persist:session-preview');
    expect(getPreviewWebview(tab.webviewId)).toBe(webview);
  });

  it('positions the active guest over the published viewport and parks it when closed', () => {
    renderLayer();
    const tab = getBrowserTab();
    act(() => {
      usePageTabStore
        .getState()
        .updateBrowserPreviewTab(tab.id, { url: 'https://example.com/' });
      usePageTabStore
        .getState()
        .setPreviewBrowserViewport({ x: 100, y: 50, width: 640, height: 480 });
    });

    const container = guestContainer(tab.webviewId)!;
    expect(container.style.left).toBe('100px');
    expect(container.style.width).toBe('640px');
    expect(container.style.visibility).not.toBe('hidden');

    // Closing the panel parks the guest (kept alive, hidden) — no unmount.
    act(() => {
      usePageTabStore.getState().closeSessionPreview();
    });
    const parked = guestContainer(tab.webviewId)!;
    expect(parked).not.toBeNull();
    expect(parked.style.visibility).toBe('hidden');
    expect(parked.querySelector('webview')).not.toBeNull();
  });

  it('keeps guests of other projects parked and restores them on switch-back', () => {
    renderLayer();
    const tabA = getBrowserTab();
    act(() => {
      usePageTabStore
        .getState()
        .updateBrowserPreviewTab(tabA.id, { url: 'https://a.example.com/' });
      usePageTabStore
        .getState()
        .setPreviewBrowserViewport({ x: 0, y: 0, width: 800, height: 600 });
    });
    expect(guestContainer(tabA.webviewId)!.style.visibility).not.toBe('hidden');

    act(() => {
      usePageTabStore.getState().setSessionPreviewProject('project-b');
    });
    // Project A's guest stays mounted (history preserved) but parked.
    expect(guestContainer(tabA.webviewId)).not.toBeNull();
    expect(guestContainer(tabA.webviewId)!.style.visibility).toBe('hidden');

    act(() => {
      usePageTabStore.getState().setSessionPreviewProject('project-a');
    });
    expect(guestContainer(tabA.webviewId)!.style.visibility).not.toBe('hidden');
  });

  it('feeds guest navigation events back into the per-project store slice', () => {
    renderLayer();
    const tab = getBrowserTab();
    act(() => {
      usePageTabStore
        .getState()
        .updateBrowserPreviewTab(tab.id, { url: 'https://example.com/' });
    });

    const webview = guestContainer(tab.webviewId)!.querySelector(
      'webview'
    ) as HTMLElement & Record<string, unknown>;
    webview.getURL = () => 'https://example.com/report';
    webview.getTitle = () => 'Quarterly report';
    webview.isLoading = () => false;
    webview.canGoBack = () => true;
    webview.canGoForward = () => false;

    act(() => {
      webview.dispatchEvent(new Event('did-navigate'));
    });

    const updated = getBrowserTab();
    expect(updated.title).toBe('Quarterly report');
    expect(updated.url).toBe('https://example.com/report');
    expect(updated.navigation).toMatchObject({
      url: 'https://example.com/report',
      canGoBack: true,
      canGoForward: false,
    });
    // Mirror and per-project record stay in sync.
    expect(
      usePageTabStore.getState().sessionPreviewByProject['project-a'].tabs
    ).toContainEqual(updated);
  });

  it('destroys the guest only when its tab is closed', () => {
    renderLayer();
    const tab = getBrowserTab();
    act(() => {
      usePageTabStore
        .getState()
        .updateBrowserPreviewTab(tab.id, { url: 'https://example.com/' });
    });
    expect(guestContainer(tab.webviewId)).not.toBeNull();

    act(() => {
      usePageTabStore.getState().closeSessionPreviewTab(tab.id);
    });
    expect(guestContainer(tab.webviewId)).toBeNull();
    expect(getPreviewWebview(tab.webviewId)).toBeUndefined();
  });
});
