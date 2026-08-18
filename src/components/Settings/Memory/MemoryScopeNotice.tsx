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

import { memoryEditorSearch } from '@/components/Home/memoryRoute';
import { Button } from '@/components/ui/button';
import type { MemoryScopeType } from '@/service/memoryApi';
import {
  getVisibleProjectMetasForSpace,
  isUnconfiguredPlaceholderSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { ArrowRight, Folder, FolderKanban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { SettingsRow, SettingsRowGroup } from '../SettingsRowGroup';

type NoticeScopeType = Extract<MemoryScopeType, 'space' | 'project'>;

interface MemoryDestination {
  spaceId: string;
  projectId?: string;
}

export function MemoryScopeNotice({
  scopeType,
}: {
  scopeType: NoticeScopeType;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const spacesById = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);

  const destination = (() => {
    const spaces = Object.values(spacesById)
      .filter(
        (space) =>
          space.status === 'active' &&
          !isUnconfiguredPlaceholderSpace(space, projectsBySpaceId)
      )
      .sort((left, right) => left.name.localeCompare(right.name));

    if (scopeType === 'space') {
      return spaces[0] ? { spaceId: spaces[0].id } : null;
    }

    for (const space of spaces) {
      const project = getVisibleProjectMetasForSpace(
        projectsBySpaceId,
        space.id
      )[0];
      if (project) {
        return { spaceId: space.id, projectId: project.id };
      }
    }

    return null;
  })() satisfies MemoryDestination | null;

  const isSpace = scopeType === 'space';
  const title = t(
    isSpace
      ? 'layout.memory-overview-space-title'
      : 'layout.memory-overview-project-title'
  );
  const description = t(
    destination
      ? isSpace
        ? 'layout.memory-overview-space-description'
        : 'layout.memory-overview-project-description'
      : isSpace
        ? 'layout.memory-overview-no-spaces'
        : 'layout.memory-overview-no-projects'
  );
  const actionLabel = t(
    isSpace
      ? 'layout.memory-overview-open-space'
      : 'layout.memory-overview-open-project'
  );

  return (
    <SettingsRowGroup data-memory-scope-notice={scopeType}>
      <SettingsRow
        title={
          <span className="flex min-w-0 items-center gap-2">
            {isSpace ? (
              <Folder className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <FolderKanban className="h-4 w-4 shrink-0" aria-hidden />
            )}
            <span>{title}</span>
          </span>
        }
        description={description}
        action={
          destination ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              buttonRadius="full"
              onClick={() =>
                navigate(
                  {
                    pathname: '/home',
                    search: memoryEditorSearch(
                      destination.spaceId,
                      destination.projectId
                    ),
                  },
                  { state: location.state }
                )
              }
            >
              {actionLabel} <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : null
        }
      />
    </SettingsRowGroup>
  );
}
