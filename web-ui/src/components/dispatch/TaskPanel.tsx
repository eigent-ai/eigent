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

import eigentAppIconBlack from '@/assets/logo/icon_black.svg';
import eigentAppIconWhite from '@/assets/logo/icon_white.svg';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';
import { WebTaskChatBox } from '@web/components/dispatch/WebTaskChatBox';
import { useProjectDetail } from '@web/hooks/useProjectDetail';
import { useSpaces } from '@web/hooks/useSpaces';
import { useWebProjectTask } from '@web/hooks/useWebProjectTask';
import type { WebProject } from '@web/types';
import { ArrowLeft } from 'lucide-react';

export function TaskChatView({
  projectId,
  draftProject,
}: {
  projectId: string;
  draftProject?: WebProject | null;
}) {
  const {
    project: loadedProject,
    loading: projectLoading,
    error: projectError,
  } = useProjectDetail(draftProject ? undefined : projectId);
  const project = draftProject ?? loadedProject;
  const { loading: taskLoading, error: taskError } = useWebProjectTask(
    projectId,
    project
  );

  if (!draftProject && projectLoading) {
    return (
      <div className="text-ds-text-neutral-muted-default flex flex-1 items-center justify-center">
        Loading task…
      </div>
    );
  }

  if (!draftProject && projectError) {
    return (
      <div className="text-ds-text-error-default-default px-4 flex flex-1 items-center justify-center text-center">
        {projectError}
      </div>
    );
  }

  if (taskLoading) {
    return (
      <div className="text-ds-text-neutral-muted-default flex flex-1 items-center justify-center">
        Preparing chat…
      </div>
    );
  }

  if (taskError) {
    return (
      <div className="text-ds-text-error-default-default px-4 flex flex-1 items-center justify-center text-center">
        {taskError}
      </div>
    );
  }

  return (
    <div className="min-h-0 min-w-0 flex h-full flex-1 flex-col overflow-hidden">
      <WebTaskChatBox />
    </div>
  );
}

export function TaskPanelHeader({
  onBack,
  projectId,
  draftProject,
}: {
  onBack: () => void;
  projectId: string;
  draftProject?: WebProject | null;
}) {
  const appearance = useAuthStore((state) => state.appearance);
  const eigentIcon =
    appearance === 'dark' ? eigentAppIconWhite : eigentAppIconBlack;
  const { activeSpace } = useSpaces();
  const { project: loadedProject } = useProjectDetail(
    draftProject ? undefined : projectId
  );
  const project = draftProject ?? loadedProject;
  const projectName = project?.name ?? 'Project';

  return (
    <header className="bg-ds-bg-neutral-subtle-default h-12 px-3 shrink-0">
      <div className="flex h-full items-center justify-between">
        <div className="gap-2 min-w-0 flex items-center">
          <Button
            variant="ghost"
            size="md"
            buttonContent="icon-only"
            buttonRadius="full"
            aria-label="Back to projects"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <span className="text-body-sm font-semibold text-ds-text-neutral-default-default truncate">
            {activeSpace.name} / {projectName}
          </span>
        </div>

        <img
          src={eigentIcon}
          alt=""
          className="h-7 w-7 -mb-0.5 shrink-0 select-none"
          aria-hidden
        />
      </div>
    </header>
  );
}
