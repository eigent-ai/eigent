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

import { ProjectModeToggle } from '@/components/Workspace/ProjectModeToggle';
import { useIsCompactWidth } from '@/hooks/useIsCompactWidth';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  normalizeThinkingEffort,
  type SessionModeType,
} from '@/types/constants';
import { ApprovalModeSelect } from './ApprovalModeSelect';
import { ModelAndThinkingEffortSelect } from './ModelAndThinkingEffortSelect';

/**
 * Below this footer width the session mode control collapses to icon-only so
 * everything stays on a single row.
 */
const COMPACT_WIDTH_THRESHOLD = 460;

export interface BoxFooterProps {
  /** Left side: single-agent / multi-agent mode control. */
  sessionMode: SessionModeType;
  onSessionModeChange?: (mode: SessionModeType) => void;
  /** Project whose pinned model and thinking effort the selectors read and write. */
  projectId?: string | null;
  /**
   * When true, the session-mode control is interactive (Workspace / New session).
   * On a running Session the mode is locked; approval, thinking effort, and
   * model stay selectable for later tasks.
   */
  interactive?: boolean;
  disabled?: boolean;
}

/**
 * BoxFooter — project-setup row under BoxMain in the BottomBox shell.
 * Left: session mode + approval. Right: one thinking-effort and model menu.
 * Stays on a single row; the left controls collapse to icon-only when the
 * footer gets narrow.
 */
export function BoxFooter({
  sessionMode,
  onSessionModeChange,
  projectId,
  interactive = false,
  disabled = false,
}: BoxFooterProps) {
  const [footerRef, compact] = useIsCompactWidth<HTMLDivElement>(
    COMPACT_WIDTH_THRESHOLD
  );
  const projectEffort = useProjectRuntimeStore((state) =>
    projectId ? state.projects[projectId]?.metadata?.thinkingEffort : undefined
  );
  const composerThinkingEffort = useProjectRuntimeStore(
    (state) => state.composerThinkingEffort
  );
  const setProjectThinkingEffort = useProjectRuntimeStore(
    (state) => state.setProjectThinkingEffort
  );
  const setComposerThinkingEffort = useProjectRuntimeStore(
    (state) => state.setComposerThinkingEffort
  );
  const spaceEffort = useSpaceStore((state) =>
    projectId
      ? state.getProjectMeta(projectId)?.metadata?.thinkingEffort
      : undefined
  );
  const storedProjectEffort =
    projectEffort !== undefined ? projectEffort : spaceEffort;
  const thinkingEffort = projectId
    ? storedProjectEffort == null
      ? undefined
      : normalizeThinkingEffort(storedProjectEffort)
    : composerThinkingEffort;
  const spaceId = useSpaceStore((state) =>
    projectId
      ? (state.projectIdIndex[projectId] ?? state.activeSpaceId)
      : state.activeSpaceId
  );

  return (
    <div
      ref={footerRef}
      className="flex w-full items-center justify-between gap-2 px-3 py-1"
    >
      <div className="flex min-w-0 shrink items-center gap-1">
        <ProjectModeToggle
          value={sessionMode}
          onValueChange={onSessionModeChange ?? (() => {})}
          readOnly={!interactive}
          compact={compact}
          className="shrink-0"
        />
        <ApprovalModeSelect
          spaceId={spaceId}
          disabled={disabled}
          compact={compact}
          className="shrink-0"
        />
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-1">
        <ModelAndThinkingEffortSelect
          thinkingEffort={thinkingEffort}
          onThinkingEffortChange={(effort) => {
            if (projectId) {
              setProjectThinkingEffort(projectId, effort);
              return;
            }
            setComposerThinkingEffort(effort);
          }}
          disabled={disabled}
          projectId={projectId}
          readOnly={!interactive && !projectId}
          className={compact ? 'max-w-56' : undefined}
        />
      </div>
    </div>
  );
}
