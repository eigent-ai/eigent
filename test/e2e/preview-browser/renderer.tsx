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

import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import { BrowserTab } from '@/components/Session/PreviewPanel/tabs/browser/BrowserTab';
import { PreviewBrowserLayer } from '@/components/Session/PreviewPanel/tabs/browser/PreviewBrowserLayer';
import { FileTab } from '@/components/Session/PreviewPanel/tabs/FileTab';
import { HostProvider, createHost } from '@/host';
import '@/i18n';
import { createBrowserPreviewHandoff } from '@/lib/browserPreviewHandoff';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import '@/style/index.css';
import { createRoot } from 'react-dom/client';

const { ThemeProvider } = await import('@/components/Layout/ThemeProvider');
const { useAuthStore } = await import('@/store/authStore');
useAuthStore.setState({ appearanceMode: 'light' });
const query = new URLSearchParams(location.search);
const site = query.get('site')!;
const file = query.get('file')!;
usePageTabStore.setState({
  sessionPreviewProjectId: 'session-a',
  sessionPreviewByProject: {},
});
const handoff = createBrowserPreviewHandoff('session-a', (url, owner) =>
  usePageTabStore.getState().openBrowserPreview(url, owner)
);
const visit = (url: string) => {
  handoff.recordVisit(url);
  handoff.completeVisit('{"result":"Navigation completed"}');
};
// Test-only driver calls the same handoff used by the live event stream.
Object.assign(window, {
  previewTest: {
    visit,
    store: usePageTabStore,
    setMode: (mode: 'light' | 'dark') =>
      useAuthStore.setState({ appearanceMode: mode }),
  },
});
function Fixture() {
  const slice = usePageTabStore(getSessionPreviewSlice);
  const tab = slice.tabs.find((tab) => tab.id === slice.activeTabId);
  return (
    <HostProvider host={createHost()}>
      <div className="flex h-screen bg-ds-neutral-default-default text-ds-ink-default-default">
        <aside className="flex w-1/3 flex-col gap-ds-stack-section p-ds-panel-inset">
          <h1>Browser preview verification</h1>
          <MarkDown
            enableTypewriter={false}
            content={`[Open live site](${site})\n\n[Open delivered HTML](${file})`}
          />
          <button
            onClick={() =>
              usePageTabStore.getState().setSessionPreviewProject('session-b')
            }
          >
            Session B
          </button>
          <button
            onClick={() =>
              usePageTabStore.getState().setSessionPreviewProject('session-a')
            }
          >
            Session A
          </button>
          <button
            onClick={() => usePageTabStore.getState().closeSessionPreview()}
          >
            Close panel
          </button>
          <button
            onClick={() => usePageTabStore.getState().openBrowserPreview(site)}
          >
            Reopen preview
          </button>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          {slice.open && tab?.type === 'browser' ? (
            <BrowserTab
              key={tab.id}
              tab={tab}
              isDesktop
              onJumpToFiles={() =>
                usePageTabStore.getState().openFilePreview({
                  name: 'index.html',
                  path: file,
                  type: 'html',
                  isFolder: false,
                })
              }
            />
          ) : null}
          {slice.open && tab?.type === 'file' ? <FileTab tab={tab} /> : null}
        </main>
      </div>
      <PreviewBrowserLayer />
    </HostProvider>
  );
}
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <Fixture />
  </ThemeProvider>
);
