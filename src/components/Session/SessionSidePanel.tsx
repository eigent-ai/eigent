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

import { SingleAgentSidePanel } from '@/components/SingleAgent';
import { WorkforceSidePanel } from '@/components/Workforce/WorkforceSidePanel';
import type { SessionModeType } from '@/types/constants';

export interface SessionSidePanelProps {
  mode: SessionModeType;
  workforcePanelKey: string;
  hasAnyMessages: boolean;
  isSidePanelVisible: boolean;
  onToggleSidePanel: () => void;
  isExpandedOverlayOpen: boolean;
  onToggleExpandedOverlay: () => void;
  onCloseExpandedOverlay: () => void;
}

export function SessionSidePanel({
  mode,
  workforcePanelKey,
  hasAnyMessages,
  isSidePanelVisible,
  onToggleSidePanel,
  isExpandedOverlayOpen,
  onToggleExpandedOverlay,
  onCloseExpandedOverlay,
}: SessionSidePanelProps) {
  switch (mode) {
    case 'workforce':
      return (
        <WorkforceSidePanel
          workforcePanelKey={workforcePanelKey}
          hasAnyMessages={hasAnyMessages}
          isSidePanelVisible={isSidePanelVisible}
          onToggleSidePanel={onToggleSidePanel}
          isExpandedOverlayOpen={isExpandedOverlayOpen}
          onToggleExpandedOverlay={onToggleExpandedOverlay}
          onCloseExpandedOverlay={onCloseExpandedOverlay}
        />
      );
    case 'single-agent':
      return (
        <SingleAgentSidePanel
          isSidePanelVisible={isSidePanelVisible}
          onToggleSidePanel={onToggleSidePanel}
        />
      );
  }
}
