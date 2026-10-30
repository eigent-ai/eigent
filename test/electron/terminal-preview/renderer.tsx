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
import { CallRow } from '@/components/ChatBox/TimelineModes/CallRow';
import { ThemeProvider } from '@/components/Layout/ThemeProvider';
import { PreviewPanel } from '@/components/Session/PreviewPanel';
import { PreviewBrowserLayer } from '@/components/Session/PreviewPanel/tabs/browser/PreviewBrowserLayer';
import { TerminalProcessRows } from '@/components/Session/SidePanel/components/TerminalProcessRows';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HostProvider, createHost } from '@/host';
import '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { setConnectionConfig } from '@/store/connectionStore';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { useTerminalProcessStore } from '@/store/terminalProcessStore';
import '@/style/index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';

setConnectionConfig({
  brainEndpoint: 'http://127.0.0.1:18741',
  channel: 'desktop',
});
usePageTabStore.getState().setSessionPreviewProject('terminal-smoke');
usePageTabStore.getState().openPreviewTab('terminal');
useAuthStore.getState().setAppearanceMode('light');
function App() {
  const store = usePageTabStore();
  const [wide, setWide] = React.useState(true);
  const process = useTerminalProcessStore(
    (s) => s.projects['terminal-smoke']?.[0]
  );
  return (
    <HostProvider host={createHost()}>
      <ThemeProvider>
        <TooltipProvider>
          <main
            className="bg-ds-neutral-default-default text-ds-ink-default-default"
            style={{ height: '100vh', display: 'flex', padding: 16, gap: 16 }}
          >
            <section style={{ width: 280 }}>
              <h1>Summary</h1>
              <TerminalProcessRows projectId={store.sessionPreviewProjectId} />
              <Button
                onClick={() =>
                  store.setSessionPreviewProject(
                    store.sessionPreviewProjectId === 'terminal-smoke'
                      ? 'other-session'
                      : 'terminal-smoke'
                  )
                }
              >
                Switch Session
              </Button>
              <Button onClick={() => setWide(!wide)}>Resize preview</Button>
              <Button
                onClick={() =>
                  useAuthStore.getState().setAppearanceMode('dark')
                }
              >
                Toggle theme
              </Button>
              <Button onClick={() => store.addChooserPreviewTab()}>
                New view
              </Button>
              <h2>Chat timeline</h2>
              {process && (
                <CallRow
                  call={{
                    id: 'smoke-call',
                    toolCallId: process.tool_call_id,
                    runId: process.run_id,
                    executor: 'toolkit',
                    title: 'Shell exec',
                    actionKind: 'command',
                    status: 'running',
                    inputLabel: 'Input',
                    outputLabel: 'Output',
                  }}
                  runActive
                  reducedMotion
                />
              )}
              {process?.url && (
                <MarkDown
                  enableTypewriter={false}
                  content={`[Server link](${process.url})`}
                />
              )}
            </section>
            <section
              style={{
                flex: wide ? 1 : '0 0 640px',
                minWidth: 0,
                height: '100%',
              }}
            >
              {getSessionPreviewSlice(store).open && (
                <PreviewPanel
                  onJumpToFiles={() => {
                    document.body.dataset.jumpedToWorkspaceFiles = 'true';
                  }}
                />
              )}
            </section>
          </main>
          <PreviewBrowserLayer />
        </TooltipProvider>
      </ThemeProvider>
    </HostProvider>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
