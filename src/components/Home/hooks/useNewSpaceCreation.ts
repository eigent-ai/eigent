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

import { useHost } from '@/host';
import {
  createSpaceFromFolderPicker,
  getFolderSpaceErrorMessage,
} from '@/lib/createSpaceFromFolder';
import { ensureScratchSpaceWorkspaceBinding } from '@/lib/scratchSpaceWorkspace';
import { getDefaultNewSpaceName } from '@/lib/spaceLabel';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export function useNewSpaceCreation(createdFrom: string) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const host = useHost();
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const projectStore = useProjectRuntimeStore();
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const createSpaceOnServer = useSpaceStore(
    (state) => state.createSpaceOnServer
  );
  const setActiveSpace = useSpaceStore((state) => state.setActiveSpace);
  const setActiveWorkspaceTab = usePageTabStore(
    (state) => state.setActiveWorkspaceTab
  );
  const requestWorkspaceChatFocus = usePageTabStore(
    (state) => state.requestWorkspaceChatFocus
  );

  const goToWorkspace = useCallback(() => {
    setActiveWorkspaceTab('workforce');
    requestWorkspaceChatFocus();
    navigate('/');
  }, [navigate, requestWorkspaceChatFocus, setActiveWorkspaceTab]);

  const createBlankSpace = useCallback(async () => {
    try {
      const spaceId = await createSpaceOnServer({
        name: getDefaultNewSpaceName(t),
        sourceType: 'blank',
        setActive: false,
        metadata: {
          createdFrom,
          autoCreatedPlaceholder: true,
        },
      });
      await ensureScratchSpaceWorkspaceBinding({
        email,
        userId,
        space: useSpaceStore.getState().getSpaceById(spaceId),
      });
      setActiveSpace(spaceId);
      projectStore.setActiveProject(null);
      goToWorkspace();
      return true;
    } catch (error) {
      console.error('Failed to create Space:', error);
      toast.error(t('layout.spaces-create-failed'), {
        closeButton: true,
      });
      return false;
    }
  }, [
    createSpaceOnServer,
    createdFrom,
    email,
    goToWorkspace,
    projectStore,
    setActiveSpace,
    t,
    userId,
  ]);

  const createSpaceFromFolder = useCallback(async () => {
    try {
      const spaceId = await createSpaceFromFolderPicker({
        host,
        email,
        userId,
        activeSpaceId,
        projectStore,
        createdFrom,
      });
      if (!spaceId) return false;
      goToWorkspace();
      return true;
    } catch (error) {
      console.warn(
        '[useNewSpaceCreation] Failed to create folder Space:',
        error
      );
      toast.error(getFolderSpaceErrorMessage(error, t), {
        closeButton: true,
      });
      return false;
    }
  }, [
    activeSpaceId,
    createdFrom,
    email,
    goToWorkspace,
    host,
    projectStore,
    t,
    userId,
  ]);

  return { createBlankSpace, createSpaceFromFolder };
}
