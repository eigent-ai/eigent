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

import { SessionActivityPanel } from '@/components/Session/SidePanel/components/ActivityPanel';
import ExpandedOverlay from '@/components/Session/SidePanel/components/ExpandedOverlay';
import { ActivityHeader } from '@/components/Session/SidePanel/components/Header';
import { WorkforceHeaderAction } from '@/components/Session/SidePanel/components/WorkforceHeaderAction';
import type { SessionPanelScope } from '@/components/Session/SidePanel/sections/sessionPanelScope';
import { SessionMode, type SessionModeType } from '@/types/constants';
import { useState } from 'react';

export interface SessionSidePanelProps {
  mode: SessionModeType;
  workforcePanelKey: string;
  isSidePanelVisible: boolean;
  onToggleSidePanel: () => void;
  isExpandedOverlayOpen: boolean;
  onToggleExpandedOverlay: () => void;
  onCloseExpandedOverlay: () => void;
}

/** Summary (Activity) content for the Session column and its narrow popover. */
export function SessionSidePanel({
  mode,
  workforcePanelKey,
  isSidePanelVisible,
  onToggleSidePanel,
  isExpandedOverlayOpen,
  onToggleExpandedOverlay,
  onCloseExpandedOverlay,
}: SessionSidePanelProps) {
  const [scope, setScope] = useState<SessionPanelScope>('latest');

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="group/activity-section mr-ds-4 mb-ds-4 flex min-h-0 flex-col overflow-hidden rounded-ds-panel bg-ds-neutral-default-default pl-ds-8">
        <SessionActivityPanel
          scope={scope}
          header={<ActivityHeader scope={scope} onScopeChange={setScope} />}
          agentHeaderAction={
            mode === SessionMode.WORKFORCE ? (
              <WorkforceHeaderAction
                isExpandedOverlayOpen={isExpandedOverlayOpen}
                onToggleExpandedOverlay={onToggleExpandedOverlay}
              />
            ) : undefined
          }
        />
      </div>

      {mode === SessionMode.WORKFORCE ? (
        <ExpandedOverlay
          open={isExpandedOverlayOpen}
          onClose={onCloseExpandedOverlay}
          workforcePanelKey={workforcePanelKey}
          onToggleSidePanel={onToggleSidePanel}
          isSidePanelVisible={isSidePanelVisible}
        />
      ) : null}
    </div>
  );
}
