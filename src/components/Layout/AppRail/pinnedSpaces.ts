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

import { useAuthStore } from '@/store/authStore';
import {
  getPinnedSpaceIds,
  getVisibleProjectMetasForSpace,
  isDisposableBlankSpace,
  pinnedSpaceOwnerKey,
  useSpaceStore,
  type PinSpaceResult,
  type Space,
  type SpaceProjectMeta,
} from '@/store/spaceStore';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

interface PinnedSpacesChooserState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** The Choose pinned Spaces popover can be opened from any Space menu. */
export const usePinnedSpacesChooser = create<PinnedSpacesChooserState>(
  (set) => ({
    open: false,
    setOpen: (open) => set({ open }),
  })
);

/** Pin a Space, or open the chooser when every pin is taken. */
export function pinSpaceOrChoose(spaceId: string): PinSpaceResult {
  const result = useSpaceStore.getState().pinSpace(spaceId);
  if (result === 'full') usePinnedSpacesChooser.getState().setOpen(true);
  return result;
}

/** The signed-in account's pinned Spaces, in pin order. */
export function usePinnedSpaceIds(): string[] {
  const ownerKey = useAuthStore((state) => pinnedSpaceOwnerKey(state.user_id));
  return useSpaceStore(
    useShallow((state) => getPinnedSpaceIds(state, ownerKey))
  );
}

/**
 * Spaces a person can pick: not archived, and not an untouched placeholder
 * (the active Space is always listed). Newest first.
 */
export function getChoosableSpaces(
  spaces: Record<string, Space>,
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>>,
  activeSpaceId: string | null
): Space[] {
  return Object.values(spaces)
    .filter(
      (space) =>
        space.status !== 'archived' &&
        !(
          space.id === 'legacy_local' &&
          activeSpaceId !== 'legacy_local' &&
          getVisibleProjectMetasForSpace(projectsBySpaceId, space.id).length ===
            0
        ) &&
        (space.id === activeSpaceId ||
          !isDisposableBlankSpace(space, projectsBySpaceId))
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
