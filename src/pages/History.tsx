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

import {
  isHistoryTabId,
  type HistoryTabId,
} from '@/components/Dashboard/HistoryTabsNav';
import AlertDialog from '@/components/ui/alertDialog';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { cn } from '@/lib/utils';
import Setting from '@/pages/Setting';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import Agents from './Agents';
import Browser from './Browser';
import Channels from './Channels';
import Connectors from './Connectors';
import Dashboard from './Dashboard';

const TAB_ALIASES: Record<string, HistoryTabId> = {
  mcp_tools: 'connectors',
};

export default function Home() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { chatStore, projectStore } = useChatStoreAdapter();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // Compute activeTab from URL, fallback to 'projects' if not in URL or invalid
  const activeTab = useMemo(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl) {
      const normalizedTab = TAB_ALIASES[tabFromUrl] ?? tabFromUrl;
      if (isHistoryTabId(normalizedTab)) {
        return normalizedTab;
      }
    }
    return 'dashboard' as HistoryTabId;
  }, [searchParams]);

  const confirmDelete = () => {
    setDeleteModalOpen(false);
  };

  if (!chatStore || !projectStore) {
    return <div>Loading...</div>;
  }

  return (
    <div className="px-1 pb-1 pt-12 flex h-full w-full flex-1 flex-col">
      <div
        ref={scrollContainerRef}
        className="scrollbar-hide bg-ds-bg-neutral-subtle-default rounded-2xl h-full overflow-y-auto"
      >
        {/* alert dialog */}
        <AlertDialog
          isOpen={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          onConfirm={confirmDelete}
          title={t('layout.delete-task')}
          message={t('layout.delete-task-confirmation')}
          confirmText={t('layout.delete')}
          cancelText={t('layout.cancel')}
        />
        <div className="m-auto flex h-auto w-full flex-1 flex-col">
          <div
            className={cn(
              'flex h-auto min-h-[calc(100vh-80px)] w-full',
              activeTab === 'dashboard'
                ? 'px-0'
                : 'mx-auto max-w-[1020px] px-[70px]'
            )}
          >
            {activeTab === 'dashboard' && <Dashboard />}
            {activeTab === 'agents' && <Agents />}
            {activeTab === 'channels' && <Channels />}
            {activeTab === 'connectors' && <Connectors />}
            {activeTab === 'browser' && <Browser />}
            {activeTab === 'settings' && <Setting />}
          </div>
        </div>
      </div>
    </div>
  );
}
