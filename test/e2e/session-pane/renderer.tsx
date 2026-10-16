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

import Session from '@/components/Session';
import { HostProvider } from '@/host';
import i18n, { LocaleEnum } from '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { createChatStoreInstance } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import '@/style/index.css';
import { ChatTaskStatus, SessionMode } from '@/types/constants';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

await i18n.changeLanguage(LocaleEnum.English);
const { ThemeProvider } = await import('@/components/Layout/ThemeProvider');
useAuthStore.setState({ appearanceMode: 'light', hasModelConfigured: true });
const projects = Object.fromEntries(
  ['a', 'b'].map((id) => {
    const chat = createChatStoreInstance();
    chat.getState().create(`task-${id}`);
    chat.getState().setStatus(`task-${id}`, ChatTaskStatus.FINISHED);
    chat.getState().addMessages(`task-${id}`, {
      id: `message-${id}`,
      role: 'user',
      content: `Session ${id.toUpperCase()} prompt`,
    });
    return [
      id,
      {
        id,
        name: `Session ${id.toUpperCase()}`,
        createdAt: 1,
        updatedAt: 1,
        mode: SessionMode.SINGLE_AGENT,
        workdirMode: null,
        chatStores: { chat },
        chatStoreTimestamps: { chat: 1 },
        activeChatId: 'chat',
        queuedMessages: [],
        metadata: {},
      },
    ];
  })
);
useProjectRuntimeStore.setState({ activeProjectId: 'a', projects });
usePageTabStore.setState({
  activeWorkspaceTab: 'project',
  sessionPreviewProjectId: 'a',
  sessionPreviewByProject: {},
  sessionSummaryOpenByProject: {},
});
Object.assign(window, {
  paneTest: {
    projects: useProjectRuntimeStore,
    tabs: usePageTabStore,
    setMode: (mode: 'light' | 'dark') =>
      useAuthStore.setState({ appearanceMode: mode }),
  },
});
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <HostProvider host={{ ipcRenderer: null, electronAPI: null }}>
      <ThemeProvider>
        <div className="flex h-screen bg-ds-neutral-subtle-default text-ds-ink-default-default">
          <Session projectId="a" />
          <Session projectId="b" />
        </div>
      </ThemeProvider>
    </HostProvider>
  </BrowserRouter>
);
