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
import WordCarousel from '@/components/ui/WordCarousel';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import Project from '@/pages/Projects/Project';
import Setting from '@/pages/Setting';
import { useAuthStore } from '@/store/authStore';
import { useEffect, useMemo, useRef, useState } from 'react';
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

  /** Mount each tab once when first opened; keep mounted and hide inactive so lists do not refetch on every tab switch. */
  const [visitedTabs, setVisitedTabs] = useState<HistoryTabId[]>(() => [
    activeTab,
  ]);

  useEffect(() => {
    setVisitedTabs((prev) =>
      prev.includes(activeTab) ? prev : [...prev, activeTab]
    );
  }, [activeTab]);

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

  /** User's local time: morning 5–12, afternoon 12–17, evening/night otherwise */
  const hour = new Date().getHours();
  const timeGreetingKey =
    hour >= 5 && hour < 12
      ? 'layout.greeting-morning'
      : hour >= 12 && hour < 17
        ? 'layout.greeting-afternoon'
        : 'layout.greeting-evening';

  const confirmDelete = () => {
    setDeleteModalOpen(false);
  };

  if (!chatStore || !projectStore) {
    return <div>Loading...</div>;
  }

  return (
    <div className="px-1 pb-1 pt-10 flex h-full w-full flex-1 flex-col">
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
        {/* welcome text */}
        <div className="from-ds-bg-neutral-default-default to-ds-bg-neutral-default-default py-8 flex w-full flex-row bg-gradient-to-b px-[74px]">
          <p className="m-0 gap-2 inline-flex flex-wrap items-baseline">
            <WordCarousel
              words={[t(timeGreetingKey)]}
              className="history-welcome-headline text-heading-xl font-bold tracking-tight not-italic"
              rotateIntervalMs={100}
              sweepDurationMs={2000}
              sweepOnce
              gradient="linear-gradient(90deg, var(--ds-text-brand-subtle-default) 0%, var(--ds-text-brand-muted-default) 100%)"
            />
            <span className="history-welcome-headline text-heading-xl font-bold tracking-tight text-ds-text-brand-default-default italic">
              {`, ${welcomeName} !`}
            </span>
          </p>
        </div>
        {/* Navbar */}
        {/* -top-px avoids a visible hairline: at top-0 subpixel rounding can leave a gap; */}
        <div
          className={`border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default pt-2 sticky -top-px z-20 flex flex-col items-center justify-between border-x-0 border-t-0 border-b-1 border-solid px-[70px]`}
        >
          <div className="mx-auto flex w-full flex-row items-center">
            <HistoryTabsNav activeTab={activeTab} onChange={handleTabChange} />
          </div>
        </div>
        <div className="m-auto flex h-auto w-full max-w-[1020px] flex-1 flex-col">
          <div className="px-6 flex h-auto min-h-[calc(100vh-80px)] w-full">
            {visitedTabs.includes('projects') && (
              <div
                className={activeTab === 'projects' ? 'contents' : 'hidden'}
                aria-hidden={activeTab !== 'projects'}
              >
                <Project />
              </div>
            )}
            {visitedTabs.includes('agents') && (
              <div
                className={activeTab === 'agents' ? 'contents' : 'hidden'}
                aria-hidden={activeTab !== 'agents'}
              >
                <Agents />
              </div>
            )}
            {visitedTabs.includes('channels') && (
              <div
                className={activeTab === 'channels' ? 'contents' : 'hidden'}
                aria-hidden={activeTab !== 'channels'}
              >
                <Channels />
              </div>
            )}
            {visitedTabs.includes('connectors') && (
              <div
                className={activeTab === 'connectors' ? 'contents' : 'hidden'}
                aria-hidden={activeTab !== 'connectors'}
              >
                <Connectors />
              </div>
            )}
            {visitedTabs.includes('browser') && (
              <div
                className={activeTab === 'browser' ? 'contents' : 'hidden'}
                aria-hidden={activeTab !== 'browser'}
              >
                <Browser />
              </div>
            )}
            {visitedTabs.includes('settings') && (
              <div
                className={activeTab === 'settings' ? 'contents' : 'hidden'}
                aria-hidden={activeTab !== 'settings'}
              >
                <Setting />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
