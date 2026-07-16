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

import { PreviewPanel } from '@/components/Session/PreviewPanel';
import {
  registerPreviewWebview,
  unregisterPreviewWebview,
} from '@/components/Session/PreviewPanel/tabs/browser/webviewRegistry';
import { HostProvider } from '@/host';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Folder/FilePreview', () => ({
  FilePreview: ({ file }: { file: FileInfo | null }) => (
    <div data-testid="file-preview">{file?.name || 'No file selected'}</div>
  ),
}));

// React Flow needs layout APIs jsdom lacks; the canvas tab is exercised
// elsewhere, so stub it to keep this suite focused on the router/tab strip.
vi.mock('@/components/Session/PreviewPanel/tabs/CanvasTab', () => ({
  CanvasTab: () => <div data-testid="canvas-tab" />,
}));

// The desktop host is detected by electronAPI presence; embedded browsing
// itself is <webview>-tag based and driven through the webview registry.
const openExternal = vi.fn();
const host = { ipcRenderer: null, electronAPI: { openExternal } };

function renderPanel() {
  return render(
    <HostProvider host={host}>
      <PreviewPanel />
    </HostProvider>
  );
}

function previewSlice() {
  return getSessionPreviewSlice(usePageTabStore.getState());
}

function activeType() {
  const slice = previewSlice();
  return slice.tabs.find((tab) => tab.id === slice.activeTabId)?.type;
}

describe('PreviewPanel', () => {
  beforeEach(() => {
    openExternal.mockReset();
    openExternal.mockResolvedValue({ success: true });
    usePageTabStore.setState({
      sessionPreviewProjectId: null,
      sessionPreviewByProject: {},
      previewBrowserViewport: null,
    });
    usePageTabStore.getState().setSessionPreviewProject('project-test');
    usePageTabStore.getState().toggleSessionPreview();
  });

  it('opens on the chooser tab listing the available content kinds', () => {
    renderPanel();
    expect(screen.getByRole('tab', { name: 'New tab' })).toBeInTheDocument();
    // Vertical options (test i18n echoes the key, not the label).
    for (const kind of ['browser', 'file']) {
      expect(
        screen.getByRole('button', {
          name: new RegExp(`preview-kind-${kind}\\b`),
        })
      ).toBeInTheDocument();
    }
    // Reserved kinds stay hidden from the chooser until a later version.
    for (const kind of ['review', 'terminal', 'canvas']) {
      expect(
        screen.queryByRole('button', {
          name: new RegExp(`preview-kind-${kind}\\b`),
        })
      ).not.toBeInTheDocument();
    }
  });

  it('picking a chooser option turns the tab into that content kind', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      screen.getByRole('button', { name: /preview-kind-browser\b/ })
    );
    expect(activeType()).toBe('browser');
    // Address bar of the browser tab is now shown.
    expect(
      screen.getByRole('textbox', { name: 'layout.browser-url-placeholder' })
    ).toBeInTheDocument();
  });

  it('routes to the file tab and reuses its tab by path', () => {
    const file = { name: 'notes.md', path: '/tmp/notes.md' } as FileInfo;
    usePageTabStore.getState().openFilePreview(file);
    usePageTabStore.getState().openFilePreview({ ...file });
    renderPanel();

    expect(screen.getByTestId('file-preview')).toHaveTextContent('notes.md');
    expect(screen.getAllByRole('tab', { name: 'notes.md' })).toHaveLength(1);
  });

  it('routes review, terminal, and canvas tabs to their surfaces', () => {
    const store = usePageTabStore.getState();
    const chooserId = previewSlice().tabs[0].id;
    act(() => store.choosePreviewTabType(chooserId, 'canvas'));
    const { rerender } = renderPanel();
    expect(screen.getByTestId('canvas-tab')).toBeInTheDocument();

    act(() =>
      store.choosePreviewTabType(previewSlice().activeTabId!, 'terminal')
    );
    rerender(
      <HostProvider host={host}>
        <PreviewPanel />
      </HostProvider>
    );
    expect(screen.getByText('Eigent:~$')).toBeInTheDocument();
  });

  it('the + button adds a new chooser tab', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      screen.getByRole('button', { name: 'layout.add-preview-tab' })
    );
    expect(screen.getAllByRole('tab', { name: 'New tab' })).toHaveLength(2);
    expect(activeType()).toBe('chooser');
  });

  it('drives back/forward/reload on the registered guest element', async () => {
    const user = userEvent.setup();
    const store = usePageTabStore.getState();
    const chooserId = previewSlice().tabs[0].id;
    act(() => store.choosePreviewTabType(chooserId, 'browser'));
    const browserTab = previewSlice().tabs.find(
      (tab) => tab.type === 'browser'
    )!;
    act(() =>
      store.updateBrowserPreviewTab(browserTab.id, {
        url: 'https://example.com/a',
        navigation: {
          url: 'https://example.com/a',
          title: 'A',
          isLoading: false,
          canGoBack: true,
          canGoForward: true,
        },
      })
    );
    const goBack = vi.fn();
    const goForward = vi.fn();
    const reload = vi.fn();
    registerPreviewWebview(browserTab.webviewId, {
      goBack,
      goForward,
      reload,
    } as unknown as HTMLElement & { goBack: typeof goBack });

    try {
      renderPanel();
      await user.click(
        screen.getByRole('button', { name: 'layout.browser-back' })
      );
      await user.click(
        screen.getByRole('button', { name: 'layout.browser-forward' })
      );
      await user.click(
        screen.getByRole('button', { name: 'layout.browser-reload' })
      );

      expect(goBack).toHaveBeenCalled();
      expect(goForward).toHaveBeenCalled();
      expect(reload).toHaveBeenCalled();
    } finally {
      unregisterPreviewWebview(browserTab.webviewId);
    }
  });

  it('opens desktop external links through the Electron external IPC', async () => {
    const user = userEvent.setup();
    const store = usePageTabStore.getState();
    const chooserId = previewSlice().tabs[0].id;
    act(() => store.choosePreviewTabType(chooserId, 'browser'));
    const browserTab = previewSlice().tabs.find(
      (tab) => tab.type === 'browser'
    )!;
    act(() =>
      store.updateBrowserPreviewTab(browserTab.id, {
        url: 'http://localhost:3000/',
      })
    );

    renderPanel();
    await user.click(
      screen.getByRole('button', { name: 'layout.browser-open-external' })
    );

    expect(openExternal).toHaveBeenCalledWith('http://localhost:3000/');
  });

  it('closing the final tab closes the panel', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      screen.getByRole('button', { name: 'layout.close-preview-tab' })
    );

    expect(previewSlice()).toMatchObject({
      open: false,
      tabs: [],
      activeTabId: null,
    });
  });
});
