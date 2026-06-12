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

import { SessionSidePanelFoldButton } from '@/components/Session/SessionSidePanelFoldButton';
import type { SessionModeType } from '@/types/constants';
import type { ReactNode } from 'react';

export interface SessionSidePanelHeaderProps {
  title: string;
  mode: SessionModeType;
  isSidePanelVisible: boolean;
  onToggle: () => void;
  /** Optional content rendered immediately after the fold button (left side). */
  start?: ReactNode;
  /** Optional right-side content (e.g. workforce expand overlay) */
  end?: ReactNode;
}

export function SessionSidePanelHeader({
  title,
  mode,
  isSidePanelVisible,
  onToggle,
  start,
  end,
}: SessionSidePanelHeaderProps) {
  return (
    <div className="relative z-50 flex w-full min-w-0 shrink-0 items-center p-2">
      <div className="flex min-w-0 flex-1 items-center justify-start gap-1">
        <SessionSidePanelFoldButton
          sessionSidePanelMode={mode}
          isSidePanelVisible={isSidePanelVisible}
          onToggle={onToggle}
        />
        <span className="min-w-0 max-w-full truncate text-center text-body-md font-semibold text-ds-text-neutral-default-default">
          {title}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        {start}
        {end != null ? (
          <div className="flex items-center gap-1">{end}</div>
        ) : null}
      </div>
    </div>
  );
}
