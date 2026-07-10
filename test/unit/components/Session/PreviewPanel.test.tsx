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
import { HostProvider } from '@/host';
import { usePageTabStore } from '@/store/pageTabStore';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Folder/FilePreview', () => ({
  FilePreview: ({ file }: { file: FileInfo | null }) => (
    <div data-testid="file-preview">{file?.name || 'No file selected'}</div>
  ),
}));

const createWebView = vi.fn().mockResolvedValue({ success: true });
const showWebview = vi.fn().mockResolvedValue({ success: true });
const hideWebView = vi.fn().mockResolvedValue({ success: true });
const changeViewSize = vi.fn().mockResolvedValue({ success: true });
const webviewDestroy = vi.fn().mockResolvedValue({ success: true });
const navigateWebview = vi.fn().mockResolvedValue({ success: true });
const goBackWebview = vi.fn().mockResolvedValue({ success: true });
const goForwardWebview = vi.fn().mockResolvedValue({ success: true });
const reloadWebview = vi.fn().mockResolvedValue({ success: true });
let navigationListener:
  | ((
      webviewId: string,
      state: {
        url: string;
        title: string;
        isLoading: boolean;
        canGoBack: boolean;
        canGoForward: boolean;
      }
    ) => void)
  | undefined;
const onPreviewWebviewStateChanged = vi.fn((listener) => {
  navigationListener = listener;
  return vi.fn();
});

const host = {
  ipcRenderer: null,
  electronAPI: {
    createWebView,
    showWebview,
    hideWebView,
    changeViewSize,
    webviewDestroy,
    navigateWebview,
    goBackWebview,
    goForwardWebview,
    reloadWebview,
    onPreviewWebviewStateChanged,
  },
};

function renderPanel() {
  return render(
    <HostProvider host={host}>
      <PreviewPanel />
    </HostProvider>
  );
}

describe('PreviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationListener = undefined;
    usePageTabStore.setState({
      sessionPreviewOpen: false,
      sessionPreviewTabs: [],
      activeSessionPreviewTabId: null,
    });
    usePageTabStore.getState().toggleSessionPreview();
  });

  it('renders tabs and adds browser or file tabs from the add menu', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByRole('tab', { name: 'New tab' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Open file' })).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'layout.add-preview-tab' })
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'layout.add-browser-tab' })
    );

    expect(screen.getAllByRole('tab', { name: 'New tab' })).toHaveLength(2);
    expect(screen.getAllByRole('tab', { name: 'New tab' })[1]).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await user.click(
      screen.getByRole('button', { name: 'layout.add-preview-tab' })
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'layout.add-file-tab' })
    );

    expect(screen.getAllByRole('tab', { name: 'Open file' })).toHaveLength(2);
  });

  it('shows the current file and reuses its tab by path', () => {
    const file = { name: 'notes.md', path: '/tmp/notes.md' } as FileInfo;
    usePageTabStore.getState().openFilePreview(file);
    usePageTabStore.getState().openFilePreview({ ...file });
    renderPanel();

    expect(screen.getByTestId('file-preview')).toHaveTextContent('notes.md');
    expect(screen.getAllByRole('tab', { name: 'notes.md' })).toHaveLength(1);
  });

  it('normalizes and navigates to URLs through the existing webview API', async () => {
    const user = userEvent.setup();
    renderPanel();
    const address = screen.getByRole('textbox', {
      name: 'layout.browser-url-placeholder',
    });

    await user.type(address, 'example.com/docs{Enter}');

    await waitFor(() =>
      expect(navigateWebview).toHaveBeenCalledWith(
        expect.stringMatching(/^session-preview:/),
        'https://example.com/docs'
      )
    );
    expect(showWebview).toHaveBeenCalled();
  });

  it('updates the browser tab title from native navigation state', async () => {
    renderPanel();
    const browserTab = usePageTabStore
      .getState()
      .sessionPreviewTabs.find((tab) => tab.type === 'browser');
    expect(browserTab?.type).toBe('browser');

    act(() => {
      navigationListener?.(browserTab!.webviewId, {
        url: 'https://example.com/report',
        title: 'Quarterly report',
        isLoading: false,
        canGoBack: true,
        canGoForward: false,
      });
    });

    expect(
      await screen.findByRole('tab', { name: 'Quarterly report' })
    ).toBeInTheDocument();
  });

  it('destroys a preview-owned webview when its tab closes', async () => {
    const user = userEvent.setup();
    renderPanel();
    const browserTab = usePageTabStore
      .getState()
      .sessionPreviewTabs.find((tab) => tab.type === 'browser');

    await user.click(
      screen.getAllByRole('button', { name: 'layout.close-preview-tab' })[0]
    );

    expect(webviewDestroy).toHaveBeenCalledWith(browserTab!.webviewId);
    expect(
      screen.queryByRole('tab', { name: 'New tab' })
    ).not.toBeInTheDocument();
  });
});
