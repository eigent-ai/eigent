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

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import ShinyText from '@/components/ui/ShinyText/ShinyText';
import type { ProjectedWriterWait } from '@/lib/projector';
import { ensureProjectRuntimeLoaded } from '@/lib/projectRuntimeHydration';
import { usePageTabStore, WorkspaceTab } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useTranslation } from 'react-i18next';

/** Show another Session of this Space, hydrating it like a sidebar click. */
function openSession(projectId: string) {
  const projectStore = useProjectRuntimeStore.getState();
  projectStore.setActiveProject(projectId);
  usePageTabStore.getState().setActiveWorkspaceTab(WorkspaceTab.Project);
  void ensureProjectRuntimeLoaded(projectStore, projectId, {
    requireActiveSelection: true,
  });
}

/** Explains why a task waits to write to its Space instead of "Preparing". */
export function SpaceWaitNotice({ wait }: { wait: ProjectedWriterWait }) {
  const { t } = useTranslation();
  const activeProjectId = useProjectRuntimeStore(
    (state) => state.activeProjectId
  );
  // Offer only another Session the sidebar lists; this one is already open.
  const blockerProjectId = useSpaceStore((state) =>
    wait.blockerProjectId &&
    wait.blockerProjectId !== activeProjectId &&
    state.getProjectMeta(wait.blockerProjectId)
      ? wait.blockerProjectId
      : undefined
  );

  if (!wait.holderNeedsAttention) {
    return (
      <div
        className="flex w-full min-w-0 flex-col gap-ds-2"
        role="status"
        aria-live="polite"
      >
        <ShinyText
          text={t('chat.workspace-waiting-title')}
          className="!text-ds-text-base !font-normal"
          speed={2.5}
        />
        <DsText role="meta" className="text-ds-ink-muted-default">
          {t('chat.workspace-waiting-description', { position: '' })}
        </DsText>
      </div>
    );
  }

  return (
    <Alert tone="warning" role="status" aria-live="polite">
      <div className="flex flex-col gap-ds-stack-related">
        <DsText role="base" weight="medium">
          {t('chat.workspace-waiting-title')}
        </DsText>
        <DsText role="base">
          {t('chat.workspace-holder-attention-description')}
        </DsText>
        {blockerProjectId ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              tone="warning"
              size="sm"
              onClick={() => openSession(blockerProjectId)}
            >
              {t('chat.workspace-open-blocking-session')}
            </Button>
          </div>
        ) : null}
      </div>
    </Alert>
  );
}
