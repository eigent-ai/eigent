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

import { SidePanelFoldButton } from '@/components/Session/SidePanel/components/FoldButton';
import type { SessionModeType } from '@/types/constants';
import type { ReactNode } from 'react';

export interface SidePanelHeaderProps {
  title: string;
  mode: SessionModeType;
  isSidePanelVisible: boolean;
  onToggle: () => void;
  /** Optional right-side content (e.g. workforce expand overlay) */
  end?: ReactNode;
}

export function SidePanelHeader({
  title,
  mode,
  isSidePanelVisible,
  onToggle,
  end,
}: SidePanelHeaderProps) {
  return (
    <div className="relative z-50 flex h-ds-layout-row-header min-h-ds-layout-row-header w-full min-w-0 shrink-0 items-center overflow-visible px-ds-8">
      <div className="flex min-w-0 flex-1 items-center justify-start gap-1">
        <SidePanelFoldButton
          sessionSidePanelMode={mode}
          isSidePanelVisible={isSidePanelVisible}
          onToggle={onToggle}
        />
        <span className="max-w-full min-w-0 truncate text-center text-ds-text-body-large font-semibold text-ds-ink-default-default">
          {title}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        {end != null ? (
          <div className="flex items-center gap-1">{end}</div>
        ) : null}
      </div>
    </div>
  );
}
