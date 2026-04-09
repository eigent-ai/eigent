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

import BrowserAgentWorkspace from '@/components/BrowserAgentWorkSpace';
import Folder from '@/components/Folder';
import TerminalAgentWorkspace from '@/components/TerminalAgentWorkspace';
import Workflow from '@/components/WorkFlow';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';

/** Shared workforce main canvas: browser, workflow, terminal, document folders, inbox. */
export function WorkspaceContent() {
  const { chatStore } = useChatStoreAdapter();
  const activeTask = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]
    : null;
  const activeWorkSpace = activeTask?.activeWorkspace;

  if (!chatStore || !activeTask || !activeWorkSpace) {
    return (
      <div className="flex h-full w-full flex-1 items-center justify-center">
        <div className="relative flex h-full w-full flex-col">
          <div className="inset-0 rounded-xl pointer-events-none absolute bg-transparent"></div>
          <div className="relative z-10 h-full w-full">
            <Workflow taskAssigning={[]} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {activeTask.taskAssigning?.find(
        (agent) => agent.agent_id === activeWorkSpace
      )?.type === 'browser_agent' && (
        <div className="flex h-full w-full flex-1">
          <BrowserAgentWorkspace />
        </div>
      )}
      {activeWorkSpace === 'workflow' && (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <div className="relative flex h-full w-full flex-col">
            <div className="inset-0 rounded-xl pointer-events-none absolute bg-transparent"></div>
            <div className="relative z-10 h-full w-full">
              <Workflow taskAssigning={activeTask.taskAssigning || []} />
            </div>
          </div>
        </div>
      )}
      {activeTask.taskAssigning?.find(
        (agent) => agent.agent_id === activeWorkSpace
      )?.type === 'developer_agent' && (
        <div className="flex h-full w-full flex-1">
          <TerminalAgentWorkspace />
        </div>
      )}
      {activeWorkSpace === 'documentWorkSpace' && (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <div className="relative flex h-full w-full flex-col">
            <div className="blur-bg inset-0 rounded-xl bg-surface-secondary pointer-events-none absolute"></div>
            <div className="relative z-10 h-full w-full">
              <Folder />
            </div>
          </div>
        </div>
      )}
      {activeTask.taskAssigning?.find(
        (agent) => agent.agent_id === activeWorkSpace
      )?.type === 'document_agent' && (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <div className="relative flex h-full w-full flex-col">
            <div className="blur-bg inset-0 rounded-xl bg-surface-secondary pointer-events-none absolute"></div>
            <div className="relative z-10 h-full w-full">
              <Folder
                data={activeTask.taskAssigning?.find(
                  (agent) => agent.agent_id === activeWorkSpace
                )}
              />
            </div>
          </div>
        </div>
      )}
      {activeWorkSpace === 'inbox' && (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <div className="relative flex h-full w-full flex-col">
            <div className="blur-bg inset-0 rounded-xl bg-surface-secondary pointer-events-none absolute"></div>
            <div className="relative z-10 h-full w-full">
              <Folder />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
