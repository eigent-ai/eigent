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
  HistoryTabsNav,
  isHistoryTabId,
  type HistoryTabId,
} from '@/components/Dashboard/HistoryTabsNav';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import WordCarousel from '@/components/ui/WordCarousel';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import Project from '@/pages/Projects/Project';
import Setting from '@/pages/Setting';
import { useAuthStore } from '@/store/authStore';
import { Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Agents from './Agents';
import Browser from './Browser';
import Channels from './Channels';
import Connectors from './Connectors';

const TAB_ALIASES: Record<string, HistoryTabId> = {
  mcp_tools: 'connectors',
};

export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { chatStore, projectStore } = useChatStoreAdapter();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const { username, email } = useAuthStore();
  const displayName = username || email || '';

  // Compute activeTab from URL, fallback to 'projects' if not in URL or invalid
  const activeTab = useMemo(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl) {
      const normalizedTab = TAB_ALIASES[tabFromUrl] ?? tabFromUrl;
      if (isHistoryTabId(normalizedTab)) {
        return normalizedTab;
      }
    }
    return 'projects' as HistoryTabId;
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    if (value) {
      navigate(`?tab=${value}`, { replace: true });
    }
  };

  const formatWelcomeName = (raw: string): string => {
    if (!raw) return '';
    if (/^[^@]+@gmail\.com$/i.test(raw)) {
      const local = raw.split('@')[0];
      const pretty = local.replace(/[._-]+/g, ' ').trim();
      return pretty
        .split(/\s+/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
    }
    return raw;
  };

  const welcomeName = formatWelcomeName(displayName);

  const confirmDelete = () => {
    setDeleteModalOpen(false);
  };

  // create task
  const createChat = () => {
    //Handles refocusing id & non duplicate logic internally
    projectStore?.createProject('new project');
    navigate('/');
  };

  if (!chatStore || !projectStore) {
    return <div>Loading...</div>;
  }

  return (
    <div
      ref={scrollContainerRef}
      className="scrollbar-hide bg-ds-bg-neutral-subtle-default mx-auto h-full overflow-y-auto"
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
      {/* welcome text */}
      <div className="from-ds-bg-neutral-default-default to-ds-bg-neutral-default-default px-20 pt-16 flex w-full flex-row bg-gradient-to-b">
        <WordCarousel
          words={[`${t('layout.welcome')}, ${welcomeName} !`]}
          className="text-heading-xl font-bold tracking-tight"
          rotateIntervalMs={100}
          sweepDurationMs={2000}
          sweepOnce
          gradient={`linear-gradient(in oklch 90deg,
            var(--ds-bg-neutral-default-default) 0%,
            var(--ds-bg-brand-muted-disabled) 50%,
            var(--ds-bg-brand-subtle-disabled) 100%)`}
          ariaLabel="rotating headline"
        />
      </div>
      {/* Navbar */}
      {/* -top-px avoids a visible hairline: at top-0 subpixel rounding can leave a gap; */}
      <div
        className={`border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default pl-20 pr-4 pt-10 sticky -top-px z-20 flex flex-col items-center justify-between border-x-0 border-t-0 border-b-1 border-solid`}
      >
        <div className="mx-auto flex w-full flex-row items-center justify-between">
          <div className="gap-2 flex items-center">
            <HistoryTabsNav activeTab={activeTab} onChange={handleTabChange} />
          </div>
          <Button
            variant="primary"
            tone="default"
            buttonRadius="full"
            size="sm"
            onClick={createChat}
            className="mb-2"
          >
            <Plus className="h-4 w-4 shrink-0" />
            {t('layout.new-project')}
          </Button>
        </div>
      </div>
      <div className="m-auto flex h-auto w-full max-w-[980px] flex-1 flex-col">
        <div className="px-6 flex h-auto min-h-[calc(100vh-80px)] w-full">
          {activeTab === 'projects' && <Project />}
          {activeTab === 'agents' && <Agents />}
          {activeTab === 'channels' && <Channels />}
          {activeTab === 'connectors' && <Connectors />}
          {activeTab === 'browser' && <Browser />}
          {activeTab === 'settings' && <Setting />}
        </div>
      </div>
    </div>
  );
}
