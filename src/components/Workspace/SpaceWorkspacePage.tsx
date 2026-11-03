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

import HomeHubRoot from '@/components/Home';
import SpaceDetail from '@/components/Home/SpaceDetail';
import type { SpaceDetailTab } from '@/components/Home/SpaceDetailTabsNav';
import { WorkspaceTab, usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useState } from 'react';

function ActiveSpaceWorkspace({ spaceId }: { spaceId: string }) {
  const setActiveWorkspaceTab = usePageTabStore(
    (state) => state.setActiveWorkspaceTab
  );
  const [tab, setTab] = useState<SpaceDetailTab>('projects');
  return (
    <SpaceDetail
      spaceId={spaceId}
      activeTab={tab}
      onTabChange={setTab}
      onBack={() => setActiveWorkspaceTab(WorkspaceTab.Workforce)}
      presentation="space-view"
    />
  );
}

/**
 * The active Space's Workspace page in the Space view: the same overview
 * Home shows for a Space, opened from the Space's row in the sidebar.
 */
export function SpaceWorkspacePage() {
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  if (!activeSpaceId) return null;
  return (
    <HomeHubRoot>
      <ActiveSpaceWorkspace key={activeSpaceId} spaceId={activeSpaceId} />
    </HomeHubRoot>
  );
}
