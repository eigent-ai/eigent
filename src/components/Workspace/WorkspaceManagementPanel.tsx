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

import { APP_SHELL_SIDEBAR_WIDTH_PX } from '@/components/Layout/AppShellLayout';
import { NavTab } from '@/components/Layout/AppSidebar';
import { Brain, FolderKanban, ToolCase } from 'lucide-react';

export type WorkspaceSubPage =
  | 'all-projects'
  | 'memory-settings'
  | 'space-settings';

interface WorkspaceManagementPanelProps {
  onOpen: (page: WorkspaceSubPage) => void;
}

/** Quick management destinations shown beside the Workspace composer. */
export function WorkspaceManagementPanel({
  onOpen,
}: WorkspaceManagementPanelProps) {
  return (
    <aside
      aria-label="Workspace management"
      className="m-1 box-border flex shrink-0 flex-col rounded-2xl bg-ds-bg-neutral-default-default p-1"
      style={{ width: APP_SHELL_SIDEBAR_WIDTH_PX }}
    >
      <nav className="flex w-full min-w-0 flex-col gap-1">
        <NavTab
          active={false}
          onClick={() => onOpen('space-settings')}
          leading={<ToolCase className="h-4 w-4 shrink-0" aria-hidden />}
          label="Space settings"
          ariaLabel="Space settings"
        />
        <NavTab
          active={false}
          onClick={() => onOpen('memory-settings')}
          leading={<Brain className="h-4 w-4 shrink-0" aria-hidden />}
          label="Memory settings"
          ariaLabel="Memory settings"
        />
        <NavTab
          active={false}
          onClick={() => onOpen('all-projects')}
          leading={<FolderKanban className="h-4 w-4 shrink-0" aria-hidden />}
          label="All projects"
          ariaLabel="All projects"
        />
      </nav>
    </aside>
  );
}
