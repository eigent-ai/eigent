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

import Workflow from '@/components/WorkFlow';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useSelectedProjectTurn } from '@/hooks/useSelectedProjectTurn';
import { ReactFlowProvider } from '@xyflow/react';

/**
 * The live workforce graph hosted inside the session preview tab system.
 * Its own provider keeps the workflow viewport isolated from other canvases.
 */
export function WorkflowTab() {
  const { projectStore } = useChatStoreAdapter();
  const selectedTurn = useSelectedProjectTurn(projectStore.activeProjectId);

  return (
    <div className="h-full min-h-0 w-full overflow-hidden bg-ds-bg-neutral-default-default">
      <ReactFlowProvider>
        <Workflow taskAssigning={selectedTurn.task?.taskAssigning ?? []} />
      </ReactFlowProvider>
    </div>
  );
}

export default WorkflowTab;
