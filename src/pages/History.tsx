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

import { Compass } from '@/components/animate-ui/icons/compass';
import { Hammer } from '@/components/animate-ui/icons/hammer';
import { Settings } from '@/components/animate-ui/icons/settings';
import { Sparkle } from '@/components/animate-ui/icons/sparkle';
import {
  MenuToggleGroup,
  MenuToggleItem,
} from '@/components/MenuButton/MenuButton';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import WordCarousel from '@/components/ui/WordCarousel';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import Project from '@/pages/Dashboard/Project';
import Setting from '@/pages/Setting';
import { useAuthStore } from '@/store/authStore';
import { Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Browser from './Dashboard/Browser';
import MCP from './Setting/MCP';

const VALID_TABS = [
  'projects',
  'workers',
  'trigger',
  'settings',
  'mcp_tools',
  'browser',
] as const;

type TabType = (typeof VALID_TABS)[number];

export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { chatStore, projectStore } = useChatStoreAdapter();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const { username, email } = useAuthStore();
  const displayName = username ?? email ?? '';

  // Compute activeTab from URL, fallback to 'projects' if not in URL or invalid
  const activeTab = useMemo(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && VALID_TABS.includes(tabFromUrl as TabType)) {
      return tabFromUrl as TabType;
    }
    return 'projects' as TabType;
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
      className="scrollbar-hide mx-auto h-full overflow-y-auto"
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
      <div className="flex w-full flex-row bg-gradient-to-b from-surface-primary to-surface-primary px-20 pt-16">
        <WordCarousel
          words={[`${t('layout.welcome')}, ${welcomeName} !`]}
          className="text-heading-xl font-bold tracking-tight"
          rotateIntervalMs={100}
          sweepDurationMs={2000}
          sweepOnce
          gradient={`linear-gradient(in oklch 90deg,
							#f9f8f6 0%, var(--colors-blue-300) 30%,
							var(--colors-emerald-default) 50%,
							var(--colors-green-500) 70%,
							var(--colors-orange-300) 100%)`}
          ariaLabel="rotating headline"
        />
      </div>
      {/* Navbar */}
      {/* -top-px avoids a visible hairline: at top-0 subpixel rounding can leave a gap; */}
      <div
        className={`sticky -top-px z-20 flex flex-col items-center justify-between border-x-0 border-t-0 border-solid border-border-disabled bg-bg-page-default px-20 pb-4 pt-10`}
      >
        <div className="mx-auto flex w-full flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <MenuToggleGroup
              type="single"
              value={activeTab}
              orientation="horizontal"
              onValueChange={handleTabChange}
            >
              <MenuToggleItem
                size="xs"
                value="projects"
                iconAnimateOnHover="wiggle"
                icon={<Sparkle />}
              >
                {t('layout.projects')}
              </MenuToggleItem>
              <MenuToggleItem
                size="xs"
                value="mcp_tools"
                iconAnimateOnHover="default"
                icon={<Hammer />}
              >
                {t('layout.mcp-tools')}
              </MenuToggleItem>
              <MenuToggleItem
                size="xs"
                value="browser"
                iconAnimateOnHover="default"
                icon={<Compass />}
              >
                {t('layout.browser')}
              </MenuToggleItem>
              <MenuToggleItem
                size="xs"
                value="settings"
                iconAnimateOnHover="default"
                icon={<Settings />}
              >
                {t('layout.settings')}
              </MenuToggleItem>
            </MenuToggleGroup>
          </div>
          <Button variant="primary" size="sm" onClick={createChat}>
            <Plus />
            {t('layout.new-project')}
          </Button>
        </div>
      </div>
      {activeTab === 'projects' && <Project />}
      {activeTab === 'mcp_tools' && <MCP />}
      {activeTab === 'browser' && <Browser />}
      {activeTab === 'settings' && <Setting />}
    </div>
  );
}
