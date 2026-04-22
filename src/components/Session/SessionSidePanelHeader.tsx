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
  /** Optional right-side content (e.g. workforce expand overlay) */
  end?: ReactNode;
}

export function SessionSidePanelHeader({
  title,
  mode,
  isSidePanelVisible,
  onToggle,
  end,
}: SessionSidePanelHeaderProps) {
  return (
    <div className="py-2 pl-2 pr-4 min-w-0 relative z-50 flex w-full shrink-0 items-center">
      <div className="min-w-0 flex flex-1 items-center justify-start">
        <SessionSidePanelFoldButton
          sessionSidePanelMode={mode}
          isSidePanelVisible={isSidePanelVisible}
          onToggle={onToggle}
        />
      </div>
      <div className="min-w-0 px-1 flex flex-1 items-center justify-center">
        <span className="text-ds-text-neutral-default-default min-w-0 text-body-md font-semibold max-w-full truncate text-center">
          {title}
        </span>
      </div>
      <div className="min-w-0 flex flex-1 items-center justify-end">
        {end != null ? (
          <div className="gap-1 flex items-center">{end}</div>
        ) : null}
      </div>
    </div>
  );
}
