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
  const changedOwner =
    existing?.agent &&
    recovered.agent &&
    existing.agent.agent_id !== recovered.agent.agent_id;
  const changedOutcome =
    existing?.status &&
    recovered.status &&
    (recovered.status === TaskStatus.COMPLETED ||
      recovered.status === TaskStatus.FAILED) &&
    existing.status !== recovered.status;
  const newerAttempt =
    typeof existing?.failure_count === 'number' &&
    typeof recovered.failure_count === 'number' &&
    recovered.failure_count > existing.failure_count;
  // Keep a full live report only when the available facts still identify the
  // same execution. A failed/older attempt must not become a successful report.
  if (existing && (changedOwner || changedOutcome || newerAttempt)) {
    existing = { ...existing };
    delete existing.report;
    delete existing.reportTruncated;
    // A missing DONE/END can leave this same attempt running/skipped after
    // its complete tool evidence arrived. Outcome alone is not a new attempt.
    if (
      changedOwner ||
      newerAttempt ||
      (changedOutcome &&
        (existing.status === TaskStatus.FAILED ||
          existing.status === TaskStatus.COMPLETED))
    )
      delete existing.toolkits;
  }
  const merged = { ...recovered, ...existing };
  merged.content ||= recovered.content;
  if (changedOwner) merged.agent = recovered.agent;
  else merged.agent ||= recovered.agent;
  if (recovered.agent) {
    if (recovered.reAssignTo) merged.reAssignTo = recovered.reAssignTo;
    else delete merged.reAssignTo;
  }
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
  events: readonly TerminalDisplayEvent[],
  runId?: string
): DisplayState {
  if (!events.length) return current;
  const tasks = new Map<string, TaskInfo>();
  const steps = new Map<string, { todoId: string; agentId: string }>();
  const todoScopes = new Map<
    string,
    { runId: string; ids: Set<string>; activeId?: string }
  >();
  const toolOwners = new Map<
    string,
    { taskId: string; agentId: string; runId: string } | null
  >();
  // Only identity is read ahead. Routing uses the snapshot at receipt time,
  // never the final all-completed Todo list or terminal-safe UI statuses.
  const runIds = new Set(
    [
      ...(runId ? [runId] : []),
      ...events
        .filter((event) => event.step === 'todo_state')
        .map((event) => text(event.payload.task_id)),
    ].filter(Boolean)
  );
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
  const checkpointToolIds = new Set(
    events
      .filter(
        (event) =>
          event.step === 'deactivate_toolkit' &&
          event.payload.semantic &&
          typeof event.payload.display_output === 'string'
      )
      .map((event) => text(event.payload.tool_call_id))
      .filter(Boolean)
  );
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
  const resolveReceiptTaskId = (
    data: Record<string, unknown>,
    allowActiveTodo = true
  ): string => {
    const semantic = object(data.semantic);
    const correlation = object(semantic.correlation);
    const actor = object(semantic.actor);
    const explicitRun = text(data.run_id) || text(correlation.run_id);
    if (runId && explicitRun && explicitRun !== runId) return '';
    const direct = text(data.process_task_id) || text(data.task_id);
    const actorId =
      text(data.agent_id) || text(data.assignee_id) || text(actor.id);
    const actorName = (text(data.agent_name) || text(actor.name))
      .split('.')
      .at(-1);
    const matchesAgent = (agentId?: string) => {
      if (actorId && actorId !== agentId) return false;
      const agent = agentId ? agents.get(agentId) : undefined;
      return (
        !actorName ||
        !agent ||
        actorName === agent.type ||
        actorName === agent.name
      );
    };
    const known =
      tasks.get(direct) ||
      current.taskRunning.find((task) => task.id === direct) ||
      current.taskInfo.find((task) => task.id === direct);
    if (known && !runIds.has(direct))
      return matchesAgent(known.agent?.agent_id) ? direct : '';

    const stepId = text(data.step_id) || text(correlation.step_id);
    if (stepId) {
      const step = steps.get(stepId);
      const scope = step && todoScopes.get(step.agentId);
      return step &&
        scope &&
        scope.ids.has(step.todoId) &&
        (!direct || direct === scope.runId || direct === step.todoId) &&
        (!explicitRun || explicitRun === scope.runId) &&
        matchesAgent(step.agentId)
        ? step.todoId
        : '';
    }
    const callId = text(data.tool_call_id);
    if (callId && toolOwners.has(callId)) {
      const owner = toolOwners.get(callId);
      return owner &&
        (!direct || direct === owner.runId || direct === owner.taskId) &&
        (!explicitRun || explicitRun === owner.runId) &&
        matchesAgent(owner.agentId)
        ? owner.taskId
        : '';
    }
    const candidates = [...todoScopes.entries()].filter(
      ([agentId, scope]) =>
        (!direct || direct === scope.runId) &&
        (!explicitRun || explicitRun === scope.runId) &&
        matchesAgent(agentId)
    );
    if (candidates.length === 1)
      return allowActiveTodo ? candidates[0][1].activeId || '' : '';
    if (todoScopes.size || runIds.has(direct) || actorName === 'single_agent')
      return '';
    // Legacy Workforce can deliver a result before its assignment frame.
    return direct;
  };
  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    const data = event.payload;
    if (event.step === 'step.created' || event.step === 'step.started') {
      const step = object(data.step);
      const owner = object(step.owner);
      if (
        owner.kind === 'single_agent' &&
        text(step.step_id) &&
        text(step.plan_item_id)
      )
        steps.set(text(step.step_id), {
          todoId: text(step.plan_item_id),
          agentId: text(owner.agent_id),
        });
      continue;
    }
    if (event.step === 'create_agent') {
      ensureAgent(text(data.agent_id), data);
      continue;
    }
    if (event.step === 'todo_state') {
      const scopeRunId = text(data.task_id) || runId || '';
      if (runId && scopeRunId !== runId) continue;
      const agentId =
        text(data.agent_id) || (scopeRunId ? `${scopeRunId}-single-agent` : '');
      const agent = ensureAgent(agentId, {
        ...data,
        agent_name: 'single_agent',
      });
      const todos = (Array.isArray(data.todos) ? data.todos : []).map(object);
      const active = todos.filter((todo) =>
        ['running', 'in_progress'].includes(text(todo.status))
      );
      if (agent)
        todoScopes.set(agentId, {
          runId: scopeRunId,
          ids: new Set(todos.map((todo) => text(todo.id)).filter(Boolean)),
          activeId: active.length === 1 ? text(active[0].id) : undefined,
        });
      for (const todo of todos) {
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
    if (
      ['tool.prepared', 'tool.dispatched', 'activate_toolkit'].includes(
        event.step
      )
    ) {
      const callId = text(data.tool_call_id);
      // Capture only the first initiation, never a later dispatch/legacy echo
      // after the plan advances. An unverified initiation stays unverified.
      if (callId && !toolOwners.has(callId)) {
        const taskId = resolveReceiptTaskId(data);
        const agentId = tasks.get(taskId)?.agent?.agent_id;
        const scope = agentId ? todoScopes.get(agentId) : undefined;
        // Workforce subtask IDs already identify their owner directly.
        if (taskId && !scope) continue;
        toolOwners.set(
          callId,
          agentId && scope?.ids.has(taskId)
            ? { taskId, agentId, runId: scope.runId }
            : null
        );
      }
      continue;
    }
    if (event.step === 'assign_task' || event.step === 'task_state') {
      const id = text(data.task_id);
      if (!id) continue;
      let task = ensureTask(id, text(data.display_input) || text(data.content));
      const nextStatus = terminalStatus(data.status ?? data.state);
      const failureCount =
        typeof data.failure_count === 'number' &&
        Number.isSafeInteger(data.failure_count) &&
        data.failure_count >= 0
          ? data.failure_count
          : undefined;
      if (event.step === 'assign_task') {
        const agent = ensureAgent(text(data.assignee_id), data);
        if (
          task.status === TaskStatus.FAILED ||
          (agent && task.agent && agent.agent_id !== task.agent.agent_id) ||
          (failureCount !== undefined &&
            task.failure_count !== undefined &&
            failureCount > task.failure_count)
        ) {
          // Detach the previous assignee's snapshot before recording the retry.
          task = { ...task };
          delete task.report;
          delete task.reportTruncated;
          delete task.toolkits;
          delete task.reAssignTo;
          tasks.set(id, task);
        }
        if (agent) task.agent = { ...agent, tasks: [], status: 'completed' };
        if (agent) {
          for (const previous of agents.values()) {
            if (previous.agent_id === agent.agent_id) continue;
            previous.tasks = previous.tasks.map((item) =>
              item.id === id && !item.reAssignTo
                ? { ...item, reAssignTo: agent.name }
                : item
            );
          }
          const index = agent.tasks.findIndex((item) => item.id === id);
          if (index < 0) agent.tasks.push(task);
          else agent.tasks[index] = task;
        }
      } else {
        if (
          task.status === TaskStatus.FAILED &&
          nextStatus === TaskStatus.COMPLETED
        ) {
          delete task.report;
          delete task.reportTruncated;
        }
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
      task.status = nextStatus;
      if (failureCount !== undefined) task.failure_count = failureCount;
      continue;
    }
    if (
      !['deactivate_toolkit', 'terminal', 'write_file', 'notice'].includes(
        event.step
      )
    )
      continue;
    // The typed checkpoint already identifies the authored Step. Its legacy
    // echo can arrive after a Todo transition and is not another tool call.
    if (
      event.step === 'deactivate_toolkit' &&
      !data.semantic &&
      checkpointToolIds.has(text(data.tool_call_id))
    )
      continue;
    const id = resolveReceiptTaskId(data, event.step !== 'deactivate_toolkit');
    if (!id) continue;
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
    taskAssigning: [...agents.values()].map((agent) => {
      const existingAgent = current.taskAssigning.find(
        (item) => item.agent_id === agent.agent_id
      );
      const assignedTasks = agent.tasks.map((task) => {
        const latest = tasks.get(task.id);
        if (!latest) return task;
        // A previous assignee keeps its own outcome, not the latest owner's.
        const recovered =
          task.reAssignTo ||
          (latest.agent && latest.agent.agent_id !== agent.agent_id)
            ? task
            : latest;
        return mergeTask(
          existingAgent?.tasks.find((item) => item.id === task.id),
          recovered
        );
      });
      return {
        ...agent,
        status: assignedTasks.some(
          (task) => !task.reAssignTo && task.status === TaskStatus.COMPLETED
        )
          ? 'completed'
          : agent.status === 'failed'
            ? 'failed'
            : 'completed',
        tasks: assignedTasks,
      };
    }),
  };
}
