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
  ProjectNavListRows,
  type ProjectNavItem,
} from '@/components/ProjectPageSidebar/ProjectNavListRows';
import { useTranslation } from 'react-i18next';

interface WorkspaceAllSessionsProps {
  projects: ProjectNavItem[];
  activeProjectId?: string | null;
  onProjectClick: (projectId: string) => void;
}

export function WorkspaceAllSessions({
  projects,
  activeProjectId,
  onProjectClick,
}: WorkspaceAllSessionsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <div className="m-0 mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {projects.length === 0 ? (
          <p className="m-0 px-3 py-6 text-center text-body-sm text-ds-text-neutral-muted-default">
            {t('layout.sessions-create-task-hint')}
          </p>
        ) : (
          <ProjectNavListRows
            projects={projects}
            activeProjectId={activeProjectId}
            onProjectClick={onProjectClick}
            folded={false}
            panelListHover
            showRowMenu={false}
          />
        )}
      </div>
    </div>
  );
}
