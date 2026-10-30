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

/**
 * One terminal stream shown in the preview panel's terminal tab. Streams map
 * 1:1 to agent subtasks that produced command output (`AgentStep.TERMINAL`
 * events append to `TaskInfo.terminal`).
 */
export interface TerminalSource {
  /** Stable identity across turns: chat, turn task, and subtask ids. */
  id: string;
  /** Display name of the agent that ran the commands. */
  agentName: string;
  /** The subtask the commands ran for (may be empty on single-agent runs). */
  taskLabel: string;
  /**
   * Append-only output lines. The chat store mutates this array in place
   * (`addTerminal` pushes), so consumers must track a written count rather
   * than rely on array identity.
   */
  lines: string[];
  /**
   * `running` while the owning subtask is still executing (a started server
   * or long-running script); `idle` once it finished.
   */
  status: 'running' | 'idle';
}

/** The slice of a chat store's state the collector needs. */
export interface TerminalChatEntry {
  chatId: string;
  tasks: Record<string, { taskAssigning?: Agent[] } | undefined>;
}

const AGENT_TYPE_LABELS: Record<string, string> = {
  developer_agent: 'Developer Agent',
  browser_agent: 'Browser Agent',
  document_agent: 'Document Agent',
  multi_modal_agent: 'Multi Modal Agent',
  social_media_agent: 'Social Media Agent',
  single_agent: 'CAMEL Agent',
};

/**
 * Flatten every subtask with terminal output across the project's chats into
 * an ordered list of streams. Entries are expected oldest-first (as returned
 * by `getAllChatStores`), so the last source is the most recent stream.
 */
export function collectTerminalSources(
  entries: TerminalChatEntry[]
): TerminalSource[] {
  const sources: TerminalSource[] = [];
  for (const { chatId, tasks } of entries) {
    for (const [taskId, task] of Object.entries(tasks)) {
      for (const agent of task?.taskAssigning ?? []) {
        for (const subtask of agent.tasks ?? []) {
          if (!subtask.terminal || subtask.terminal.length === 0) continue;
          sources.push({
            id: `${chatId}:${taskId}:${subtask.id}`,
            agentName:
              agent.name || AGENT_TYPE_LABELS[agent.type] || agent.type,
            taskLabel: (subtask.content || '').trim(),
            lines: subtask.terminal,
            status: subtask.status === 'running' ? 'running' : 'idle',
          });
        }
      }
    }
  }
  return sources;
}
