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
import type { SessionModeType } from '@/types/constants';
import { ModelSelect } from './ModelSelect';

/**
 * Below this footer width the session mode control collapses to icon-only so
 * everything stays on a single row.
 */
const COMPACT_WIDTH_THRESHOLD = 460;

export interface BoxFooterProps {
  /** Left side: single-agent / multi-agent mode control. */
  sessionMode: SessionModeType;
  onSessionModeChange?: (mode: SessionModeType) => void;
  /** Project whose pinned model the model selector reads and writes. */
  projectId?: string | null;
  /**
   * Project-setup controls: interactive on the workspace composer only.
   * Once the project has started both controls render read-only.
   */
  interactive?: boolean;
  disabled?: boolean;
}

/**
 * BoxFooter — project-setup row under BoxMain in the BottomBox shell.
 * Left: session mode control. Right: default/project-pinned model control.
 * Stays on a single row; the left control collapses to icon-only when the
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
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ModelSelect
          disabled={disabled}
          projectId={projectId}
          readOnly={!interactive && !projectId}
        />
      </div>
    </div>
  );
}
