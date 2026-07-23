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
import HomeHub from '@/pages/Home';
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
  projects: 'home',
  spaces: 'home',
};

export default function History() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const { username, email } = useAuthStore();
  const displayName = username || email || '';

  const activeTab = useMemo(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl) {
      const normalizedTab = TAB_ALIASES[tabFromUrl] ?? tabFromUrl;
      if (isHistoryTabId(normalizedTab)) {
        return normalizedTab;
      }
    }
    return 'home' as HistoryTabId;
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

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    const section = searchParams.get('section');
    if ((tabFromUrl === 'spaces' || tabFromUrl === 'projects') && !section) {
      const legacySection = tabFromUrl === 'spaces' ? 'spaces' : 'projects';
      navigate(`?tab=home&section=${legacySection}`, { replace: true });
      return;
    }
    // When landing on Home with no section, default to Spaces so the
    // URL is always self-describing (lets HomeHub render directly from
    // searchParams without an internal default).
    const isHomeTab = tabFromUrl === 'home' || tabFromUrl === null;
    if (isHomeTab && !section) {
      navigate(`?tab=home&section=spaces`, { replace: true });
    }
  }, [navigate, searchParams]);

  const handleTabChange = (value: string) => {
    if (value) {
      if (value === 'home') {
        navigate(`?tab=home&section=spaces`, { replace: true });
        return;
      }
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

  return (
    <div className="flex h-full w-full flex-1 flex-col px-1 pb-1 pt-10">
      <div
        ref={scrollContainerRef}
        className="scrollbar-hide h-full overflow-y-auto rounded-2xl bg-ds-bg-neutral-subtle-default"
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
        <div className="flex w-full flex-row bg-gradient-to-b from-ds-bg-neutral-default-default to-ds-bg-neutral-default-default px-[74px] py-8">
          <p className="m-0 inline-flex flex-wrap items-baseline gap-2">
            <WordCarousel
              words={[t(timeGreetingKey)]}
              className="history-welcome-headline text-heading-xl font-bold not-italic tracking-tight"
              rotateIntervalMs={100}
              sweepDurationMs={2000}
              sweepOnce
              gradient="linear-gradient(90deg, var(--ds-text-brand-subtle-default) 0%, var(--ds-text-brand-muted-default) 100%)"
            />
            <span className="history-welcome-headline text-heading-xl font-bold italic tracking-tight text-ds-text-brand-default-default">
              {`, ${welcomeName} !`}
            </span>
          </p>
        </div>
        {/* Navbar */}
        {/* -top-px avoids a visible hairline: at top-0 subpixel rounding can leave a gap; */}
        <div
          className={`border-b-1 sticky -top-px z-20 flex flex-col items-center justify-between border-x-0 border-t-0 border-solid border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default px-[70px] pt-2`}
        >
          <div className="mx-auto flex w-full flex-row items-center">
            <HistoryTabsNav activeTab={activeTab} onChange={handleTabChange} />
          </div>
        </div>
        {visitedTabs.includes('home') && (
          <div
            className={
              activeTab === 'home'
                ? 'flex h-auto w-full px-[70px] pb-[120px]'
                : 'hidden'
            }
            aria-hidden={activeTab !== 'home'}
          >
            <HomeHub />
          </div>
        )}
        <div className="m-auto flex h-auto w-full max-w-[1020px] flex-1 flex-col">
          <div className="flex h-auto w-full px-6 pb-[120px] [--home-hub-history-tabs-offset:49px]">
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
