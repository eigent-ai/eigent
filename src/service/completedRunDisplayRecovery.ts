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

import { TaskStatus } from '@/types/constants';
import i18next from 'i18next';
import type { TerminalDisplayEvent } from './runUsageReconciliation';

type DisplayState = {
  taskAssigning: Agent[];
  taskRunning: TaskInfo[];
  taskInfo: TaskInfo[];
};
type Toolkit = NonNullable<TaskInfo['toolkits']>[number];
// Same presentation names and hidden workers as the live CREATE_AGENT path.
const INTERNAL_AGENTS = new Set([
  'mcp_agent',
  'new_worker_agent',
  'task_agent',
  'task_summary_agent',
  'coordinator_agent',
  'question_confirm_agent',
]);
const AGENT_NAMES: Record<string, [string, string]> = {
  developer_agent: ['chat.developer-agent', 'Developer agent'],
  browser_agent: ['chat.browser-agent', 'Browser agent'],
  document_agent: ['chat.document-agent', 'Document agent'],
  multi_modal_agent: ['chat.multimodal-agent', 'Multimodal agent'],
  social_media_agent: ['chat.social-media-agent', 'Social media agent'],
  single_agent: ['chat.camel-agent', 'CAMEL agent'],
};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const terminalStatus = (value: unknown) => {
  const status = text(value).toLowerCase();
  return status === 'done' || status === 'completed'
    ? TaskStatus.COMPLETED
    : status === 'failed'
      ? TaskStatus.FAILED
      : TaskStatus.SKIPPED;
};

function mergeToolkits(existing: Toolkit[] = [], recovered: Toolkit[] = []) {
  const merged = existing.map((toolkit) => ({ ...toolkit }));
  for (const receipt of recovered) {
    const sameTool = (toolkit: Toolkit) =>
      toolkit.toolkitName === receipt.toolkitName &&
      toolkit.toolkitMethods === receipt.toolkitMethods;
    const duplicate = merged.findIndex(
      (toolkit) =>
        sameTool(toolkit) &&
        (toolkit.message === receipt.message ||
          toolkit.message.endsWith(`\n${receipt.message}`))
    );
    if (duplicate >= 0) {
      merged[duplicate].toolkitStatus = 'completed';
      continue;
    }
    const pending = merged.findLastIndex(
      (toolkit) => sameTool(toolkit) && toolkit.toolkitStatus === 'running'
    );
    if (pending >= 0) {
      merged[pending] = {
        ...merged[pending],
        toolkitStatus: 'completed',
        message: [merged[pending].message, receipt.message]
          .filter(Boolean)
          .join('\n'),
      };
    } else merged.push({ ...receipt });
  }
  return merged;
}

function mergeTask(
  existing: TaskInfo | undefined,
  recovered: TaskInfo
): TaskInfo {
  const merged = { ...recovered, ...existing };
  merged.content ||= recovered.content;
  merged.agent ||= recovered.agent;
  merged.status =
    recovered.status === TaskStatus.COMPLETED ||
    recovered.status === TaskStatus.FAILED
      ? recovered.status
      : terminalStatus(existing?.status);
  if (!existing?.report && recovered.report) {
    merged.report = recovered.report;
    merged.reportTruncated = recovered.reportTruncated;
  } else if (existing?.report) {
    if (existing.reportTruncated === undefined) delete merged.reportTruncated;
    else merged.reportTruncated = existing.reportTruncated;
  }
  if (recovered.failure_count !== undefined)
    merged.failure_count = Math.max(
      existing?.failure_count || 0,
      recovered.failure_count
    );
  if (recovered.toolkits?.length)
    merged.toolkits = mergeToolkits(existing?.toolkits, recovered.toolkits);
  if (recovered.terminal?.length)
    merged.terminal = [
      ...new Set([...(existing?.terminal || []), ...recovered.terminal]),
    ];
  if (recovered.fileList?.length) {
    merged.fileList = [...(existing?.fileList || [])];
    for (const file of recovered.fileList) {
      if (
        !merged.fileList.some(
          (item) =>
            item.path === file.path ||
            (item.relativePath && item.relativePath === file.relativePath)
        )
      )
        merged.fileList.push(file);
    }
  }
  return merged;
}

/** Merge validated completed-Run display facts; never replay live reducers. */
export function recoverCompletedRunDisplay(
  current: DisplayState,
  events: readonly TerminalDisplayEvent[]
): DisplayState {
  if (!events.length) return current;
  const tasks = new Map<string, TaskInfo>();
  const hiddenAgents = new Set(
    events
      .filter(
        (event) =>
          event.step === 'create_agent' &&
          INTERNAL_AGENTS.has(text(event.payload.agent_name))
      )
      .map((event) => text(event.payload.agent_id))
  );
  const agents = new Map(
    current.taskAssigning.map((agent) => [
      agent.agent_id,
      { ...agent, tasks: [...agent.tasks] },
    ])
  );
  const seen = new Set<string>();
  const ensureTask = (id: string, content = '') => {
    if (!tasks.has(id))
      tasks.set(id, { id, content, status: TaskStatus.SKIPPED });
    const task = tasks.get(id)!;
    task.content ||= content;
    return task;
  };
  const ensureAgent = (id: string, data: Record<string, unknown>) => {
    const agentName = text(data.agent_name);
    if (!id || hiddenAgents.has(id) || INTERNAL_AGENTS.has(agentName))
      return undefined;
    const name = AGENT_NAMES[agentName];
    if (!agents.has(id))
      agents.set(id, {
        agent_id: id,
        name: name
          ? i18next.t(name[0], { defaultValue: name[1] })
          : text(data.display_title) || agentName || id,
        type: (agentName || 'single_agent') as AgentNameType,
        status: 'completed',
        tasks: [],
        log: [],
      });
    return agents.get(id)!;
  };
  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    const data = event.payload;
    if (event.step === 'create_agent') {
      ensureAgent(text(data.agent_id), data);
      continue;
    }
    if (event.step === 'todo_state') {
      const agent = ensureAgent(text(data.agent_id), {
        ...data,
        agent_name: 'single_agent',
      });
      for (const raw of Array.isArray(data.todos) ? data.todos : []) {
        const todo = object(raw);
        const id = text(todo.id);
        if (!id) continue;
        const task = ensureTask(id, text(todo.content));
        task.status = terminalStatus(todo.status);
        if (agent) task.agent = { ...agent, tasks: [], status: 'completed' };
        if (agent && !agent.tasks.some((item) => item.id === id))
          agent.tasks.push(task);
      }
      continue;
    }
    const id = text(data.task_id) || text(data.process_task_id);
    if (!id) continue;
    if (event.step === 'assign_task' || event.step === 'task_state') {
      const task = ensureTask(
        id,
        text(data.display_input) || text(data.content)
      );
      task.status = terminalStatus(data.status ?? data.state);
      if (
        typeof data.failure_count === 'number' &&
        Number.isSafeInteger(data.failure_count) &&
        data.failure_count >= 0
      )
        task.failure_count = data.failure_count;
      if (event.step === 'assign_task') {
        const agent = ensureAgent(text(data.assignee_id), data);
        if (agent) task.agent = { ...agent, tasks: [], status: 'completed' };
        if (agent && !agent.tasks.some((item) => item.id === id))
          agent.tasks.push(task);
      } else {
        const report =
          typeof data.display_output === 'string'
            ? data.display_output
            : data.semantic
              ? ''
              : text(data.result);
        if (report) {
          task.report =
            data.display_output_truncated === true && !report.endsWith('…')
              ? `${report}…`
              : report;
          task.reportTruncated = data.display_output_truncated === true;
        }
      }
      continue;
    }
    if (
      !['deactivate_toolkit', 'terminal', 'write_file', 'notice'].includes(
        event.step
      )
    )
      continue;
    const task = ensureTask(id);
    if (event.step === 'terminal') {
      const output = text(data.output);
      if (output) (task.terminal ??= []).push(output);
    } else if (event.step === 'write_file') {
      const localPath = text(data.file_path);
      const relativePath = text(data.relative_path);
      const path = localPath || relativePath;
      if (!path) continue;
      const name = path.replaceAll('\\', '/').split('/').at(-1) || '';
      (task.fileList ??= []).push({
        name,
        type: name.split('.').at(-1) || '',
        path,
        relativePath: relativePath || undefined,
        localPathAvailable: Boolean(localPath),
      });
    } else {
      const notice = event.step === 'notice';
      const message = notice
        ? text(data.notice)
        : typeof data.display_output === 'string'
          ? data.display_output
          : data.semantic
            ? ''
            : text(data.message);
      const name = notice ? 'notice' : text(data.toolkit_name);
      const method = notice
        ? ''
        : text(data.method_name) || text(data.tool_name);
      if (message && name && (notice || method))
        (task.toolkits ??= []).push({
          toolkitName: name,
          toolkitMethods: method,
          message,
          toolkitStatus: 'completed',
        });
    }
  }
  const mergeCollection = (existing: TaskInfo[]) => {
    const merged = existing.map((task) =>
      tasks.has(task.id) ? mergeTask(task, tasks.get(task.id)!) : task
    );
    for (const [id, task] of tasks)
      if (!existing.some((item) => item.id === id))
        merged.push(mergeTask(undefined, task));
    return merged;
  };
  return {
    taskInfo: mergeCollection(current.taskInfo),
    taskRunning: mergeCollection(current.taskRunning),
    taskAssigning: [...agents.values()].map((agent) => ({
      ...agent,
      status: agent.status === 'failed' ? 'failed' : 'completed',
      tasks: agent.tasks.map((task) => {
        const recovered = tasks.get(task.id);
        return recovered
          ? mergeTask(task === recovered ? undefined : task, recovered)
          : task;
      }),
    })),
  };
}
