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

import type { ProjectSessionRun } from '@/hooks/useProjectSessionOverview';
import type {
  ChatActivityNode,
  ChatPlanTaskStatus,
  ChatProjectionNode,
} from '@/lib/projector/chat';
import { httpUrlOrNull } from '@/lib/richText';
import { TaskStatus, type TaskStatusType } from '@/types/constants';
import {
  extractLoadedSkillNames,
  normalizeContextKey,
  resolveContextConnector,
  type ContextConnector,
  type ContextSkill,
} from './buildContextItems';
import { mergeSidePanelOutputFiles } from './collectSidePanelOutputFiles';
import type { ContextCategory, ContextItem } from './ExecutionContextSection';

export interface SessionProgressItem {
  key: string;
  task: TaskInfo;
  taskId: string;
  historical: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SessionAgentItem {
  id: string;
  name: string;
  type: string;
  description: string;
  tools: string[];
  historical: boolean;
  createdAt: number;
  updatedAt: number;
  subagent: boolean;
}

export interface SessionToolCall {
  id: string;
  toolkitName: string;
  method: string;
  /** Safe semantic detail only; raw durable payloads never enter this model. */
  input: string;
  /** Safe semantic detail only; raw durable payloads never enter this model. */
  output: string;
  status: 'running' | 'done';
  taskId: string;
  agentName: string;
  createdAt: number;
  updatedAt: number;
  skillNames: string[];
}

export interface SessionContextItem extends Omit<ContextItem, 'onClick'> {
  historical: boolean;
  createdAt: number;
  updatedAt: number;
  calls: SessionToolCall[];
}

export interface SessionResourceItem {
  id: string;
  label: string;
  kind: 'url' | 'file';
  url?: string;
  file?: FileInfo;
  taskId: string;
  historical: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SessionFileItem {
  id: string;
  file: FileInfo;
  taskId: string;
  historical: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SessionEnvironmentItem {
  id: string;
  label: string;
  taskId: string;
  historical: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Project-wide data consumed by the locked SidePanel UI. */
export interface ProjectSessionPanelData {
  agents: SessionAgentItem[];
  contextItems: SessionContextItem[];
  environments: SessionEnvironmentItem[];
  files: SessionFileItem[];
  progress: SessionProgressItem[];
  resources: SessionResourceItem[];
  toolCalls: SessionToolCall[];
}

const ACTIVE_TOOL_STATUSES = new Set(['pending', 'running']);
const TERMINAL_TOOL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function nodeTime(node: ChatProjectionNode, fallback = 0): number {
  const parsed = node.createdAt ? Date.parse(node.createdAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback + node.runSequence;
}

function normalizedToolIdentity(node: ChatActivityNode): string {
  return JSON.stringify([
    node.runId,
    normalizeContextKey(node.agentId || node.agentName || ''),
    normalizeContextKey(node.toolkitName || node.toolName || 'tool'),
    normalizeContextKey(node.methodName || node.toolName || node.title),
  ]);
}

function safeToolDetail(node: ChatActivityNode): string {
  if (node.detail?.trim()) return node.detail.trim();
  // Legacy toolkit frames route their already-approved display text through
  // the semantic title. Typed durable events never take this compatibility
  // path and still require explicit display_detail/display_summary fields.
  if (
    node.legacyStep === 'activate_toolkit' ||
    node.legacyStep === 'deactivate_toolkit'
  ) {
    return node.title.trim();
  }
  return '';
}

function toolCallFromNode(node: ChatActivityNode): SessionToolCall {
  const active = ACTIVE_TOOL_STATUSES.has(node.status);
  const detail = safeToolDetail(node);
  return {
    id: node.toolCallId || `tool-call:${node.eventId}`,
    toolkitName: node.toolkitName?.trim() || node.toolName?.trim() || 'Tool',
    method:
      node.methodName?.trim() || node.toolName?.trim() || node.title.trim(),
    input: active ? detail : '',
    output: active ? '' : detail,
    status: active ? 'running' : 'done',
    taskId: node.runId,
    agentName: node.agentName?.trim() || '',
    createdAt: nodeTime(node),
    updatedAt: nodeTime(node),
    skillNames: [],
  };
}

function mergeToolNode(call: SessionToolCall, node: ChatActivityNode): void {
  const detail = safeToolDetail(node);
  const active = ACTIVE_TOOL_STATUSES.has(node.status);
  if (detail) {
    if (active && !call.input) call.input = detail;
    if (!active) {
      call.output = [call.output, detail].filter(Boolean).join('\n\n');
    }
  }
  call.updatedAt = Math.max(call.updatedAt, nodeTime(node));
  if (!active) call.status = 'done';
  if (!call.agentName && node.agentName) call.agentName = node.agentName;
}

/**
 * Fold immutable semantic tool lifecycle nodes into logical calls. Explicit
 * backend call IDs win; older legacy frames use FIFO pairing per identity.
 */
export function collectSessionToolCalls(
  runs: ProjectSessionRun[]
): SessionToolCall[] {
  const calls: SessionToolCall[] = [];
  const byCallId = new Map<string, SessionToolCall>();
  const anonymousOpen = new Map<string, SessionToolCall[]>();

  for (const run of [...runs].reverse()) {
    for (const node of run.nodes) {
      if (node.kind !== 'activity' || node.activityType !== 'tool') continue;
      const identity = normalizedToolIdentity(node);

      if (node.toolCallId) {
        const callKey = `${node.runId}:${node.toolCallId}`;
        const existing = byCallId.get(callKey);
        if (existing) {
          mergeToolNode(existing, node);
        } else {
          const call = toolCallFromNode(node);
          byCallId.set(callKey, call);
          calls.push(call);
        }
        continue;
      }

      if (ACTIVE_TOOL_STATUSES.has(node.status)) {
        const call = toolCallFromNode(node);
        calls.push(call);
        const pending = anonymousOpen.get(identity) ?? [];
        pending.push(call);
        anonymousOpen.set(identity, pending);
        continue;
      }

      const pending = anonymousOpen.get(identity) ?? [];
      const call = TERMINAL_TOOL_STATUSES.has(node.status)
        ? pending.shift()
        : undefined;
      if (call) {
        mergeToolNode(call, node);
      } else {
        calls.push(toolCallFromNode(node));
      }
    }
  }

  for (const call of calls) {
    if (/skill/i.test(call.toolkitName)) {
      call.skillNames = extractLoadedSkillNames(
        [call.input, call.output].filter(Boolean).join('\n')
      );
    }
  }
  return calls.sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  );
}

function collectAgents(
  runs: ProjectSessionRun[],
  calls: SessionToolCall[]
): SessionAgentItem[] {
  const agents = new Map<string, SessionAgentItem>();
  const put = (
    run: ProjectSessionRun,
    identity: string,
    name: string,
    description: string,
    subagent: boolean
  ) => {
    const key = `${subagent ? 'subagent' : 'agent'}:${normalizeContextKey(
      identity || name || 'agent'
    )}`;
    const existing = agents.get(key);
    if (!existing) {
      agents.set(key, {
        id: key,
        name,
        type: subagent ? 'subagent' : 'agent',
        description,
        tools: [],
        historical: !run.isCurrent,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        subagent,
      });
      return;
    }
    if (!existing.name && name) existing.name = name;
    if (!existing.description && description)
      existing.description = description;
    if (run.isCurrent) existing.historical = false;
    existing.createdAt = Math.max(existing.createdAt, run.createdAt);
    existing.updatedAt = Math.max(existing.updatedAt, run.updatedAt);
  };

  for (const run of runs) {
    for (const node of run.nodes) {
      if (node.kind !== 'activity') continue;
      if (node.activityType === 'agent') {
        const text = `${node.eventType} ${node.title}`.toLowerCase();
        const subagent = /sub.?agent|remote/.test(text);
        put(
          run,
          node.agentId || node.agentName || node.title,
          node.agentName || node.title,
          node.detail || '',
          subagent
        );
      } else if (node.agentId || node.agentName) {
        put(
          run,
          node.agentId || node.agentName || 'agent',
          node.agentName || '',
          '',
          false
        );
      }
    }
  }

  for (const call of calls) {
    const run = runs.find((candidate) => candidate.runId === call.taskId);
    if (!run) continue;
    const callText = `${call.toolkitName} ${call.method}`.toLowerCase();
    const subagent = /sub.?agent|remote/.test(callText);
    const identity = call.agentName || (subagent ? 'remote-subagent' : 'agent');
    put(run, identity, call.agentName, '', subagent);
    const key = `${subagent ? 'subagent' : 'agent'}:${normalizeContextKey(
      identity
    )}`;
    const agent = agents.get(key);
    if (agent && !agent.tools.includes(call.toolkitName)) {
      agent.tools.push(call.toolkitName);
    }
  }

  return [...agents.values()].sort(
    (left, right) =>
      Number(left.historical) - Number(right.historical) ||
      Number(left.subagent) - Number(right.subagent) ||
      left.name.localeCompare(right.name)
  );
}

function planStatus(status: ChatPlanTaskStatus): TaskStatusType {
  switch (status) {
    case 'completed':
      return TaskStatus.COMPLETED;
    case 'failed':
      return TaskStatus.FAILED;
    case 'skipped':
      return TaskStatus.SKIPPED;
    case 'blocked':
      return TaskStatus.BLOCKED;
    case 'running':
      return TaskStatus.RUNNING;
    default:
      return TaskStatus.WAITING;
  }
}

function activityTaskStatus(node: ChatActivityNode): TaskStatusType {
  return planStatus(node.status === 'cancelled' ? 'skipped' : node.status);
}

function collectProgress(runs: ProjectSessionRun[]): SessionProgressItem[] {
  const progress: SessionProgressItem[] = [];
  for (const run of runs) {
    const tasks = new Map<string, SessionProgressItem>();
    for (const node of run.nodes) {
      const time = nodeTime(node, run.createdAt);
      if (node.kind === 'plan') {
        for (const task of node.tasks) {
          const key = task.id || `${node.eventId}:${task.title}`;
          const existing = tasks.get(key);
          tasks.set(key, {
            key: `${run.runId}:${key}`,
            task: {
              id: key,
              content: task.title,
              status: planStatus(task.status),
            },
            taskId: run.runId,
            historical: !run.isCurrent,
            createdAt: existing?.createdAt ?? time,
            updatedAt: time,
          });
        }
      }
      if (node.kind !== 'activity' || node.activityType !== 'task') continue;
      const key = node.taskId || node.eventId;
      const existing = tasks.get(key);
      tasks.set(key, {
        key: `${run.runId}:${key}`,
        task: {
          id: key,
          content: existing?.task.content || node.detail || node.title,
          status: activityTaskStatus(node),
        },
        taskId: run.runId,
        historical: !run.isCurrent,
        createdAt: existing?.createdAt ?? time,
        updatedAt: time,
      });
    }
    progress.push(...tasks.values());
  }
  return progress.sort(
    (left, right) =>
      Number(left.historical) - Number(right.historical) ||
      left.createdAt - right.createdAt
  );
}

function displaySkillName(name: string, skills: ContextSkill[]): string {
  const match = skills.find(
    (skill) => normalizeContextKey(skill.name) === normalizeContextKey(name)
  );
  return match?.name || name;
}

function collectContext(
  runs: ProjectSessionRun[],
  calls: SessionToolCall[],
  skills: ContextSkill[],
  connectors: ContextConnector[]
): SessionContextItem[] {
  const runById = new Map(runs.map((run) => [run.runId, run]));
  const items = new Map<string, SessionContextItem>();

  const put = (
    category: Exclude<ContextCategory, 'file'>,
    label: string,
    iconUrl: string | undefined,
    call: SessionToolCall
  ) => {
    const run = runById.get(call.taskId);
    if (!run || !label.trim()) return;
    const key = `${category}:${normalizeContextKey(label)}`;
    const existing = items.get(key);
    if (existing) {
      if (!existing.calls.some((candidate) => candidate.id === call.id)) {
        existing.calls.push(call);
      }
      if (run.isCurrent) existing.historical = false;
      existing.createdAt = Math.max(existing.createdAt, run.createdAt);
      existing.updatedAt = Math.max(existing.updatedAt, call.updatedAt);
      return;
    }
    items.set(key, {
      id: key,
      label,
      category,
      iconUrl,
      historical: !run.isCurrent,
      createdAt: run.createdAt,
      updatedAt: call.updatedAt,
      calls: [call],
    });
  };

  for (const call of calls) {
    if (/skill/i.test(call.toolkitName)) {
      const names = call.skillNames.length > 0 ? call.skillNames : ['Skill'];
      for (const name of names) {
        put('skill', displaySkillName(name, skills), undefined, call);
      }
      continue;
    }

    const connector = resolveContextConnector(
      call.toolkitName,
      call.method,
      [call.input, call.output].filter(Boolean).join('\n'),
      connectors
    );
    if (connector) {
      put(
        'connector',
        connector.displayName || connector.service,
        connector.iconUrl || undefined,
        call
      );
    } else if (/mcp|connector/i.test(call.toolkitName)) {
      put('connector', call.toolkitName, undefined, call);
    }
  }

  return [...items.values()].sort(
    (left, right) =>
      Number(left.historical) - Number(right.historical) ||
      left.label.localeCompare(right.label)
  );
}

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`)\]}]+/gi;

export function extractHttpUrls(value: string): string[] {
  const matches = value.match(HTTP_URL_PATTERN) ?? [];
  const urls = new Set<string>();
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?]+$/, '');
    const url = httpUrlOrNull(cleaned);
    if (url) urls.add(url);
  }
  return [...urls];
}

function resourceLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.hostname}${path}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function safeNodeText(node: ChatProjectionNode): string {
  switch (node.kind) {
    case 'message':
      return node.content;
    case 'notice':
      return `${node.title || ''}\n${node.content}`;
    case 'interaction':
      return `${node.prompt || ''}\n${node.response || ''}`;
    case 'plan':
      return `${node.title || ''}\n${node.summary || ''}`;
    case 'activity':
      return `${node.title}\n${node.detail || ''}`;
    case 'artifact':
      return node.path;
    case 'run_status':
      return node.reason || '';
    case 'unknown':
      return '';
  }
}

function collectResources(runs: ProjectSessionRun[]): SessionResourceItem[] {
  const resources = new Map<string, SessionResourceItem>();
  for (const run of runs) {
    for (const node of run.nodes) {
      for (const url of extractHttpUrls(safeNodeText(node))) {
        const existing = resources.get(url);
        const time = nodeTime(node, run.createdAt);
        const item: SessionResourceItem = {
          id: `url:${url}`,
          label: resourceLabel(url),
          kind: 'url',
          url,
          taskId: run.runId,
          historical: !run.isCurrent,
          createdAt: existing?.createdAt ?? time,
          updatedAt: Math.max(existing?.updatedAt ?? 0, time),
        };
        if (!existing || (existing.historical && run.isCurrent)) {
          resources.set(url, item);
        } else {
          existing.updatedAt = item.updatedAt;
        }
      }
    }
  }
  return [...resources.values()].sort(
    (left, right) =>
      Number(left.historical) - Number(right.historical) ||
      right.updatedAt - left.updatedAt
  );
}

function fileInfoFromArtifact(
  node: Extract<ChatProjectionNode, { kind: 'artifact' }>
): FileInfo {
  const name =
    node.name || node.path.split('/').filter(Boolean).at(-1) || node.path;
  const isRelative = !/^(?:[a-z]+:|\/|[a-z]:[\\/])/i.test(node.path);
  return {
    name,
    type: name.includes('.') ? name.split('.').at(-1) || '' : '',
    path: node.path,
    relativePath: isRelative ? node.path : undefined,
    artifactChange:
      node.operation === 'created'
        ? 'generated'
        : node.operation === 'updated'
          ? 'changed'
          : undefined,
    mimeType: node.mimeType,
  };
}

function collectFiles(runs: ProjectSessionRun[]): SessionFileItem[] {
  const files = new Map<string, SessionFileItem>();
  for (const run of [...runs].reverse()) {
    for (const node of run.nodes) {
      if (node.kind !== 'artifact' || !node.path || httpUrlOrNull(node.path)) {
        continue;
      }
      const key = node.path;
      if (node.operation === 'deleted') {
        files.delete(key);
        continue;
      }
      const time = nodeTime(node, run.createdAt);
      const existing = files.get(key);
      files.set(key, {
        id: key,
        file: fileInfoFromArtifact(node),
        taskId: run.runId,
        historical: existing?.historical === false ? false : !run.isCurrent,
        createdAt: existing?.createdAt ?? time,
        updatedAt: time,
      });
    }
  }
  return [...files.values()].sort(
    (left, right) =>
      Number(left.historical) - Number(right.historical) ||
      right.updatedAt - left.updatedAt
  );
}

function collectEnvironments(
  runs: ProjectSessionRun[]
): SessionEnvironmentItem[] {
  const environments = new Map<string, SessionEnvironmentItem>();
  const put = (label: string, run: ProjectSessionRun, time: number) => {
    const id = label.toLowerCase();
    const existing = environments.get(id);
    if (!existing || (existing.historical && run.isCurrent)) {
      environments.set(id, {
        id,
        label,
        taskId: run.runId,
        historical: !run.isCurrent,
        createdAt: existing?.createdAt ?? time,
        updatedAt: Math.max(existing?.updatedAt ?? 0, time),
      });
    } else {
      existing.updatedAt = Math.max(existing.updatedAt, time);
    }
  };

  for (const run of runs) {
    for (const node of run.nodes) {
      if (node.kind !== 'activity') continue;
      const time = nodeTime(node, run.createdAt);
      const identity = `${node.activityType} ${node.title} ${
        node.toolkitName || ''
      } ${node.methodName || ''}`.toLowerCase();
      if (node.activityType === 'terminal' || /terminal|shell/.test(identity)) {
        put('Terminal', run, time);
      }
      if (/browser|search|scrape/.test(identity)) {
        put('Browser', run, time);
      }
      if (/sub.?agent|remote/.test(identity)) {
        put('Remote environment', run, time);
      }
    }
  }
  return [...environments.values()].sort(
    (left, right) =>
      Number(left.historical) - Number(right.historical) ||
      left.label.localeCompare(right.label)
  );
}

export function buildProjectSessionPanelData(
  runs: ProjectSessionRun[],
  skills: ContextSkill[],
  connectors: ContextConnector[] = []
): ProjectSessionPanelData {
  const toolCalls = collectSessionToolCalls(runs);
  return {
    agents: collectAgents(runs, toolCalls),
    contextItems: collectContext(runs, toolCalls, skills, connectors),
    environments: collectEnvironments(runs),
    files: collectFiles(runs),
    progress: collectProgress(runs),
    resources: collectResources(runs),
    toolCalls,
  };
}

export function mergeProjectFiles(
  items: SessionFileItem[],
  projectFiles: FileInfo[],
  fallbackTaskId: string,
  fallbackCreatedAt = 0,
  fallbackUpdatedAt = 0
): SessionFileItem[] {
  const knownFiles = items.map((item) => item.file);
  const merged = mergeSidePanelOutputFiles(knownFiles, projectFiles);
  return merged.map((file) => {
    const id = file.relativePath || file.path || file.name;
    return (
      items.find((item) => item.id === id || item.file.path === file.path) ?? {
        id,
        file,
        taskId: fallbackTaskId,
        historical: false,
        createdAt: fallbackCreatedAt,
        updatedAt: fallbackUpdatedAt,
      }
    );
  });
}

export function isProgressDone(task: TaskInfo): boolean {
  return (
    task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED
  );
}
