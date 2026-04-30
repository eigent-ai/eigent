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

import Browser from '@/components/Dashboard/Pages/Browser';
import Channels from '@/components/Dashboard/Pages/Channels';
import Connectors from '@/components/Dashboard/Pages/Connectors';
import Memory from '@/components/Dashboard/Pages/Memory/Memory';
import Models from '@/components/Dashboard/Pages/Models/Models';
import Dashboard from '@/components/Dashboard/Pages/Project';
import Setting from '@/components/Dashboard/Pages/Setting';
import Skills from '@/components/Dashboard/Pages/Skills/Skills';
import { AppResizableShell } from '@/components/Layout/AppResizableShell';
import PageSidebar from '@/components/PageSidebar';
import AlertDialog from '@/components/ui/alertDialog';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { parseHistoryNavState } from '@/lib/historyNavConfig';
import { cn } from '@/lib/utils';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

const HISTORY_SIDEBAR_WIDTH_STORAGE_KEY = 'eigent-history-sidebar-width-px';

const HISTORY_MAIN_MOTION_CLASS =
  'scrollbar-hide bg-ds-bg-neutral-subtle-default min-h-0 min-w-0 flex h-full w-full flex-col overflow-hidden rounded-2xl';

export default function History() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { chatStore, projectStore } = useChatStoreAdapter();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const navState = parseHistoryNavState(searchParams);

  const confirmDelete = () => {
    setDeleteModalOpen(false);
  };

  if (!chatStore || !projectStore) {
    return <div>Loading...</div>;
  }

  const mainContent = (
    <div
      ref={scrollContainerRef}
      className="scrollbar-hide min-h-0 flex-1 overflow-y-auto"
    >
      <div className="m-auto flex h-auto min-h-full w-full flex-1 flex-col">
        <div
          className={cn(
            'flex min-h-[calc(100vh-80px)] w-full',
            navState.tab === 'dashboard' ? 'px-0' : 'px-6'
          )}
        >
          {navState.tab === 'dashboard' && (
            <Dashboard embedded hub={navState.hub} />
          )}
          {navState.tab === 'agents' && navState.agentSection === 'models' && (
            <Models />
          )}
          {navState.tab === 'agents' && navState.agentSection === 'skills' && (
            <Skills />
          )}
          {navState.tab === 'agents' && navState.agentSection === 'memory' && (
            <Memory />
          )}
          {navState.tab === 'channels' && (
            <Channels embedded channelsView={navState.channelsView} />
          )}
          {navState.tab === 'connectors' && <Connectors />}
          {navState.tab === 'browser' && (
            <Browser embedded browserSection={navState.browserSection} />
          )}
          {navState.tab === 'settings' && (
            <Setting embedded settingsTab={navState.settingsTab} />
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-0 px-1 pb-1 pt-12 flex h-full flex-1 flex-col overflow-hidden">
      <AlertDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title={t('layout.delete-task')}
        message={t('layout.delete-task-confirmation')}
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
      />

      <AppResizableShell
        sidebarWidthStorageKey={HISTORY_SIDEBAR_WIDTH_STORAGE_KEY}
        panelGroupId="history-page-panel-group"
        sidebar={<PageSidebar variant="history" />}
        sidebarDefaultSize={26}
        main={mainContent}
        mainMotionClassName={HISTORY_MAIN_MOTION_CLASS}
        transparentShell
      />
    </div>
  );
}
