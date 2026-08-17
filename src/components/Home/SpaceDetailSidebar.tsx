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
// Licensed under the Apache License, Version 2.0 (the "License");

import {
  NavTab,
  SidebarNavGroup,
  SidebarScrollArea,
  SidebarSection,
  SidebarSeparator,
  SidebarShell,
} from '@/components/Layout/AppSidebar';
import { ensureScratchSpaceWorkspaceBinding } from '@/lib/scratchSpaceWorkspace';
import { getDefaultNewSpaceName } from '@/lib/spaceLabel';
import { useAuthStore } from '@/store/authStore';
import { isDisposableBlankSpace, useSpaceStore } from '@/store/spaceStore';
import { ArrowLeft, Check, Folder, LoaderCircle, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface SpaceDetailSidebarProps {
  selectedSpaceId: string;
  onBack: () => void;
  onSelectSpace: (spaceId: string) => void;
}

/** Detail-mode rail: a single way back plus the selectable Space list. */
export default function SpaceDetailSidebar({
  selectedSpaceId,
  onBack,
  onSelectSpace,
}: SpaceDetailSidebarProps) {
  const { t } = useTranslation();
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const spacesById = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const createSpaceOnServer = useSpaceStore(
    (state) => state.createSpaceOnServer
  );
  const [creatingSpace, setCreatingSpace] = useState(false);
  const spaces = useMemo(
    () =>
      Object.values(spacesById)
        .filter(
          (space) =>
            space.status !== 'archived' &&
            (space.id === selectedSpaceId ||
              !isDisposableBlankSpace(space, projectsBySpaceId))
        )
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [projectsBySpaceId, selectedSpaceId, spacesById]
  );

  const handleCreateSpace = useCallback(async () => {
    if (creatingSpace) return;
    setCreatingSpace(true);
    try {
      const spaceId = await createSpaceOnServer({
        name: getDefaultNewSpaceName(t),
        sourceType: 'blank',
        setActive: false,
        metadata: {
          createdFrom: 'space_detail_sidebar',
          autoCreatedPlaceholder: true,
        },
      });
      await ensureScratchSpaceWorkspaceBinding({
        email,
        userId,
        space: useSpaceStore.getState().getSpaceById(spaceId),
      });
      onSelectSpace(spaceId);
    } catch (error) {
      console.error('Failed to create Space:', error);
      toast.error(t('layout.spaces-create-failed'), { closeButton: true });
    } finally {
      setCreatingSpace(false);
    }
  }, [createSpaceOnServer, creatingSpace, email, onSelectSpace, t, userId]);

  return (
    <SidebarShell ariaLabel="Spaces">
      <SidebarSection>
        <SidebarNavGroup>
          <NavTab
            active={false}
            onClick={onBack}
            leading={<ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />}
            label="Back to Home"
            ariaLabel="Back to Home"
          />
        </SidebarNavGroup>
      </SidebarSection>
      <SidebarSeparator />
      <SidebarSection grow="fill">
        <SidebarScrollArea
          role="navigation"
          ariaLabel="Select a Space"
          className="gap-4 pt-1"
        >
          <SidebarNavGroup>
            <NavTab
              active={false}
              disabled={creatingSpace}
              onClick={() => void handleCreateSpace()}
              leading={
                creatingSpace ? (
                  <LoaderCircle
                    className="h-4 w-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                ) : (
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                )
              }
              label="New Space"
              ariaLabel="New Space"
            />
          </SidebarNavGroup>
          <SidebarNavGroup label="Spaces">
            {spaces.map((space) => {
              const selected = space.id === selectedSpaceId;
              return (
                <NavTab
                  key={space.id}
                  active={selected}
                  onClick={() => onSelectSpace(space.id)}
                  leading={<Folder className="h-4 w-4 shrink-0" aria-hidden />}
                  label={space.name?.trim() || 'Untitled Space'}
                  trailing={
                    selected ? (
                      <Check className="h-4 w-4 shrink-0" aria-hidden />
                    ) : undefined
                  }
                  tooltip={space.name?.trim() || 'Untitled Space'}
                  tooltipEnabledWhenCollapsed
                  ariaLabel={space.name?.trim() || 'Untitled Space'}
                  ariaCurrentPage={selected}
                />
              );
            })}
          </SidebarNavGroup>
        </SidebarScrollArea>
      </SidebarSection>
    </SidebarShell>
  );
}
