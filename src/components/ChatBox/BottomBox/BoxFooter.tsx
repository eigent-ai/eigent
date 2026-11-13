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
import { cn } from '@/lib/utils';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  normalizeThinkingEffort,
  type SessionModeType,
} from '@/types/constants';
import type { ReactNode } from 'react';
import { ApprovalModeSelect } from './ApprovalModeSelect';
import { FooterCompactContext } from './footerCompact';
import { ModelAndThinkingEffortSelect } from './ModelAndThinkingEffortSelect';

/**
 * Below this footer width the left controls (Space, session mode, approval)
 * collapse to icon-only buttons so everything stays on a single row.
 */
const COMPACT_WIDTH_THRESHOLD = 460;

/**
 * Session mode and approval are set-and-forget, so they sit at half strength
 * until the pointer, keyboard focus or an open menu engages them.
 */
const RECEDING_CONTROL_CLASS = cn(
  'opacity-50 transition-[background-color,opacity] duration-150 ease-out',
  'hover:opacity-100 focus:opacity-100 focus-visible:opacity-100',
  'data-[state=open]:opacity-100 aria-expanded:opacity-100'
);

export interface BoxFooterProps {
  /** Before the session mode control, for example New session's Space chip. */
  leading?: ReactNode;
  /** Left side: single-agent / multi-agent mode control. */
  sessionMode: SessionModeType;
  onSessionModeChange?: (mode: SessionModeType) => void;
  /** Project whose pinned model and thinking effort the selectors read and write. */
  projectId?: string | null;
  /**
   * Without a project, the Space whose access and default model the
   * selectors edit. Defaults to the active Space.
   */
  spaceId?: string | null;
  /**
   * When true, the session-mode control is interactive (Workspace / New session).
   * On a running Session the mode is locked; approval, thinking effort, and
   * model stay selectable for later tasks.
   */
  interactive?: boolean;
  disabled?: boolean;
  /** Keep model recovery available when only the composer is blocked by usage. */
  modelSelectDisabled?: boolean;
}

/**
 * BoxFooter — project-setup row under BoxMain in the BottomBox shell.
 * Left: session mode + approval. Right: one thinking-effort and model menu.
 * Stays on a single row; the left controls collapse to icon-only buttons
 * (no label, no chevron) when the footer gets narrow.
 */
export function BoxFooter({
  leading,
  sessionMode,
  onSessionModeChange,
  projectId,
  spaceId: spaceIdOverride,
  interactive = false,
  disabled = false,
  modelSelectDisabled = disabled,
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
      : (spaceIdOverride ?? state.activeSpaceId)
  );

  return (
    <div
      ref={footerRef}
      // 14px puts the first control's 16px icon (behind its 8px padding)
      // on the centre of the composer's "+" icon above.
      className="flex w-full items-center justify-between gap-2 py-1 pr-ds-12 pl-ds-14"
    >
      <div className="flex min-w-0 shrink items-center gap-1">
        <FooterCompactContext.Provider value={compact}>
          {leading}
        </FooterCompactContext.Provider>
        <ProjectModeToggle
          value={sessionMode}
          onValueChange={onSessionModeChange ?? (() => {})}
          readOnly={!interactive}
          compact={compact}
          className={cn('shrink-0', RECEDING_CONTROL_CLASS)}
        />
        <ApprovalModeSelect
          spaceId={spaceId}
          disabled={disabled}
          compact={compact}
          className={cn('shrink-0', RECEDING_CONTROL_CLASS)}
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
          disabled={modelSelectDisabled}
          projectId={projectId}
          spaceId={projectId ? undefined : spaceIdOverride}
          readOnly={!interactive && !projectId}
          className={compact ? 'max-w-56' : undefined}
        />
      </div>
    </div>
  );
}
