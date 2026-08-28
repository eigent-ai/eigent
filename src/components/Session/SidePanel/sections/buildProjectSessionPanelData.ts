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
import { resolveSubagentPresentationIdentity } from '@/lib/projector/chat/presentation';
import { httpUrlOrNull } from '@/lib/richText';
import { normalizeWorkspaceRelativePath } from '@/lib/workspaceRelativePath';
import { TaskStatus, type TaskStatusType } from '@/types/constants';
import {
  extractLoadedSkillNames,
  normalizeContextKey,
  resolveContextConnector,
  type ContextCategory,
  type ContextConnector,
  type ContextItem,
  type ContextSkill,
} from './buildContextItems';

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
  provider?: string;
  model?: string;
  avatarSeed: string;
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
  /** True only after a workspace resolver has supplied an openable location. */
  previewable: boolean;
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
const SKILL_LOAD_METHOD = 'load skill';
const SKILL_LIST_METHOD = 'list skills';
const TOOL_IDENTITY_CACHE = new WeakMap<ChatActivityNode, string>();
const NODE_HTTP_URL_CACHE = new WeakMap<ChatProjectionNode, string[]>();

function normalizedMethodName(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
}

function skillOperation(
  call: Pick<SessionToolCall, 'method' | 'toolkitName'>
): 'load' | 'list' | null {
  const method = normalizedMethodName(call.method);
  if (method === SKILL_LOAD_METHOD) return 'load';
  if (method === SKILL_LIST_METHOD) return 'list';

  // Canonical tool lifecycle events currently expose tool_name as both the
  // toolkit and method when no toolkit metadata is available.
  const toolkitOperation = normalizedMethodName(call.toolkitName);
  if (toolkitOperation === SKILL_LOAD_METHOD) return 'load';
  if (toolkitOperation === SKILL_LIST_METHOD) return 'list';
  return null;
}

function nodeTime(node: ChatProjectionNode, fallback = 0): number {
  const parsed = node.createdAt ? Date.parse(node.createdAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback + node.runSequence;
}

function normalizedToolIdentity(node: ChatActivityNode): string {
  const cached = TOOL_IDENTITY_CACHE.get(node);
  if (cached) return cached;
  const identity = JSON.stringify([
    node.runId,
    normalizeContextKey(node.agentId || node.agentName || ''),
    normalizeContextKey(node.toolkitName || node.toolName || 'tool'),
    normalizeContextKey(node.methodName || node.toolName || node.title),
  ]);
  TOOL_IDENTITY_CACHE.set(node, identity);
  return identity;
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

function safeToolPayload(node: ChatActivityNode, active: boolean): string {
  const explicit = active ? node.input : node.output;
  return explicit?.trim() || safeToolDetail(node);
}

function toolCallFromNode(node: ChatActivityNode): SessionToolCall {
  const active = ACTIVE_TOOL_STATUSES.has(node.status);
  const payload = safeToolPayload(node, active);
  return {
    id: node.toolCallId || `tool-call:${node.eventId}`,
    toolkitName: node.toolkitName?.trim() || node.toolName?.trim() || 'Tool',
    method:
      node.methodName?.trim() || node.toolName?.trim() || node.title.trim(),
    input: active ? payload : '',
    output: active ? '' : payload,
    status: active ? 'running' : 'done',
    taskId: node.runId,
    agentName: node.agentName?.trim() || '',
    createdAt: nodeTime(node),
    updatedAt: nodeTime(node),
    skillNames: [],
  };
}

function mergeToolNode(call: SessionToolCall, node: ChatActivityNode): void {
  const active = ACTIVE_TOOL_STATUSES.has(node.status);
  const payload = safeToolPayload(node, active);
  if (payload) {
    if (active && !call.input) call.input = payload;
    if (!active) {
      call.output = [call.output, payload].filter(Boolean).join('\n\n');
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
    if (skillOperation(call) === 'load') {
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
  const isInternalAgent = (name: string) =>
    normalizeContextKey(name) === 'questionconfirmagent';
  const put = (
    run: ProjectSessionRun,
    identity: string,
    name: string,
    description: string,
    subagent: boolean,
    provider?: string,
    model?: string,
    avatarSeed = identity,
    preferName = false
  ): SessionAgentItem => {
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
        provider,
        model,
        avatarSeed,
      });
      return agents.get(key)!;
    }
    if (name && (!existing.name || preferName)) existing.name = name;
    if (!existing.description && description)
      existing.description = description;
    if (!existing.provider && provider) existing.provider = provider;
    if (!existing.model && model) existing.model = model;
    if (run.isCurrent) existing.historical = false;
    existing.createdAt = Math.max(existing.createdAt, run.createdAt);
    existing.updatedAt = Math.max(existing.updatedAt, run.updatedAt);
    return existing;
  };

  for (const run of runs) {
    for (const node of run.nodes) {
      if (node.kind !== 'activity') continue;
      if (node.activityType === 'agent') {
        const name = node.agentName || node.title;
        if (isInternalAgent(name)) continue;
        const text = `${node.eventType} ${node.title} ${name}`.toLowerCase();
        const subagent = /sub.?agent|remote/.test(text);
        put(
          run,
          // Agent UUIDs are process instances and change on every Run. The
          // stable semantic name identifies the logical agent in the panel.
          name || node.agentId || 'agent',
          name,
          node.detail || '',
          subagent,
          node.agentProvider,
          node.agentModel,
          name || node.agentId || 'agent'
        );
      }

      if (node.subagentInvocation || node.subagentType) {
        const identity =
          node.toolCallId ||
          node.stepId ||
          node.activityId ||
          `${run.runId}:${node.eventId}`;
        const displayIdentity = resolveSubagentPresentationIdentity({
          subagentName: node.subagentName,
          subagentType: node.subagentType,
          toolCallId: node.toolCallId,
          stepId: node.stepId,
          subagentAgentId: node.subagentAgentId,
          subagentTaskId: node.subagentTaskId,
          fallbackSeed: identity,
        });
        const agent = put(
          run,
          identity,
          displayIdentity.name,
          node.input || node.detail || '',
          true,
          node.agentProvider,
          node.agentModel,
          displayIdentity.avatarSeed,
          Boolean(node.subagentName?.trim())
        );
        const toolName = node.toolkitName?.trim() || node.toolName?.trim();
        if (toolName && !agent.tools.includes(toolName)) {
          agent.tools.push(toolName);
        }
      }

      if (node.activityType !== 'agent' && (node.agentId || node.agentName)) {
        if (isInternalAgent(node.agentName || '')) continue;
        put(
          run,
          node.agentName || node.agentId || 'agent',
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
    const delegatedTool = ['agentrunsubagent', 'runremotesubagent'].includes(
      normalizeContextKey(call.method)
    );
    // Registered delegation tools are attached directly to their projected
    // subagent row above. Other toolkits must not be classified by name.
    if (delegatedTool || !call.agentName) continue;
    if (isInternalAgent(call.agentName)) continue;
    const identity = call.agentName;
    put(run, identity, call.agentName, '', false);
    const key = `agent:${normalizeContextKey(identity)}`;
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
  switch (node.status) {
    case 'cancelled':
    case 'interrupted':
      return TaskStatus.SKIPPED;
    case 'timed_out':
      return TaskStatus.FAILED;
    case 'outcome_unknown':
    case 'blocked':
      return TaskStatus.BLOCKED;
    case 'pending':
    case 'running':
    case 'completed':
    case 'failed':
    case 'unknown':
      return planStatus(node.status);
  }
}

function isLegacyTodoState(node: ChatProjectionNode): boolean {
  return (
    node.kind === 'plan' &&
    (node.legacyStep === 'todo_state' || node.eventType === 'legacy.todo_state')
  );
}

function startsTodoWrite(node: ChatProjectionNode): boolean {
  if (node.kind !== 'activity' || node.activityType !== 'tool') return false;
  return (
    ACTIVE_TOOL_STATUSES.has(node.status) &&
    [node.toolName, node.methodName, node.title].some(
      (value) => normalizeContextKey(value || '') === 'todowrite'
    )
  );
}

function collectProgress(runs: ProjectSessionRun[]): SessionProgressItem[] {
  const progress: SessionProgressItem[] = [];
  for (const run of runs) {
    const tasks = new Map<string, SessionProgressItem>();
    const todoTaskKeys = new Set<string>();
    let observedTodoWrite = false;
    for (const node of run.nodes) {
      const time = nodeTime(node, run.createdAt);
      if (startsTodoWrite(node)) observedTodoWrite = true;
      if (node.kind === 'plan') {
        const todoState = isLegacyTodoState(node);
        if (todoState) {
          // todo_state is a full-list replacement emitted by todo_write. Old
          // backends also emitted workspace-loaded todos at Run startup with
          // no TodoToolkit call; quarantine those already-durable bad events.
          if (!observedTodoWrite) continue;
          // Replace only TodoToolkit progress. Typed plans and task activity
          // are independent sources and must survive a todo list update.
          for (const key of todoTaskKeys) tasks.delete(key);
          todoTaskKeys.clear();
          observedTodoWrite = false;
        }
        for (const task of node.tasks) {
          const key = task.id || `${node.eventId}:${task.title}`;
          const mapKey = todoState ? `todo:${key}` : key;
          const existing = tasks.get(mapKey);
          tasks.set(mapKey, {
            key: `${run.runId}:${mapKey}`,
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
          if (todoState) todoTaskKeys.add(mapKey);
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
    const operation = skillOperation(call);
    if (operation) {
      // list_skills is discovery only. Its result contains every installed
      // skill's name and description and must never be presented as usage.
      // A load_skill call without a safely parsed name is also omitted rather
      // than inventing an umbrella "Skill" row.
      if (operation !== 'load') continue;
      for (const name of call.skillNames) {
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
    case 'step':
      return `${node.title}\n${node.summary || ''}`;
    case 'activity':
      return `${node.title}\n${node.detail || ''}\n${node.output || ''}`;
    case 'artifact':
      return node.path;
    case 'run_status':
      return node.reason || '';
    case 'unknown':
      return '';
  }
}

function nodeHttpUrls(node: ChatProjectionNode): string[] {
  const cached = NODE_HTTP_URL_CACHE.get(node);
  if (cached) return cached;
  const urls = extractHttpUrls(safeNodeText(node));
  NODE_HTTP_URL_CACHE.set(node, urls);
  return urls;
}

function collectResources(runs: ProjectSessionRun[]): SessionResourceItem[] {
  const resources = new Map<string, SessionResourceItem>();
  for (const run of runs) {
    for (const node of run.nodes) {
      for (const url of nodeHttpUrls(node)) {
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
  const relativePath = normalizeWorkspaceRelativePath(node.relativePath);
  return {
    name,
    type: name.includes('.') ? name.split('.').at(-1) || '' : '',
    path: node.path,
    relativePath: relativePath || undefined,
    artifactId: node.artifactId,
    artifactChange:
      node.operation === 'created'
        ? 'generated'
        : node.operation === 'updated'
          ? 'changed'
          : undefined,
    mimeType: node.mimeType,
  };
}

function artifactIdentity(
  node: Extract<ChatProjectionNode, { kind: 'artifact' }>
): string | null {
  const artifactId = node.artifactId?.trim();
  if (artifactId) return `artifact:${artifactId}`;
  const relativePath = normalizeWorkspaceRelativePath(node.relativePath);
  if (relativePath) return `relative:${relativePath}`;
  return null;
}

function fileEntryForRunRelativePath(
  files: Map<string, SessionFileItem>,
  runId: string,
  relativePath: string
): [string, SessionFileItem] | null {
  for (const entry of files.entries()) {
    const [, item] = entry;
    if (
      item.taskId === runId &&
      normalizeWorkspaceRelativePath(item.file.relativePath) === relativePath
    ) {
      return entry;
    }
  }
  return null;
}

function collectFiles(runs: ProjectSessionRun[]): SessionFileItem[] {
  const files = new Map<string, SessionFileItem>();
  for (const run of [...runs].reverse()) {
    for (const node of run.nodes) {
      if (node.kind !== 'artifact' || !node.path || httpUrlOrNull(node.path)) {
        continue;
      }
      let key = artifactIdentity(node);
      // A display-only basename must never become Run identity or an openable
      // workspace path. Wait for an artifact id or a trusted portable path.
      if (!key) continue;
      const relativePath = normalizeWorkspaceRelativePath(node.relativePath);
      const matchingRunPath = relativePath
        ? fileEntryForRunRelativePath(files, run.runId, relativePath)
        : null;
      if (node.operation === 'deleted') {
        files.delete(key);
        if (matchingRunPath) files.delete(matchingRunPath[0]);
        continue;
      }
      const time = nodeTime(node, run.createdAt);
      let existing = files.get(key);
      if (matchingRunPath && matchingRunPath[0] !== key) {
        existing ??= matchingRunPath[1];
        if (node.artifactId?.trim()) {
          // The terminal manifest upgrades the realtime relative identity to
          // its canonical artifact id without creating a second visible row.
          files.delete(matchingRunPath[0]);
        } else {
          // Preserve a canonical artifact key if an older realtime frame is
          // replayed after terminal finalization.
          key = matchingRunPath[0];
        }
      }
      const file = fileInfoFromArtifact(node);
      file.artifactId ??= existing?.file.artifactId;
      const id = file.artifactId?.trim() || relativePath || node.eventId;
      files.set(key, {
        id,
        file,
        previewable: false,
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
  projectFiles: FileInfo[]
): SessionFileItem[] {
  type UniqueFile = FileInfo | null;
  const byArtifactId = new Map<string, UniqueFile>();
  const byRelativePath = new Map<string, UniqueFile>();

  const addUnique = (
    index: Map<string, UniqueFile>,
    key: string | null | undefined,
    file: FileInfo
  ) => {
    if (!key) return;
    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, file);
      return;
    }
    if (existing?.path !== file.path) index.set(key, null);
  };

  for (const file of projectFiles) {
    addUnique(byArtifactId, file.artifactId?.trim(), file);
    addUnique(
      byRelativePath,
      normalizeWorkspaceRelativePath(file.relativePath),
      file
    );
  }

  return items.map((item) => {
    const artifactId = item.file.artifactId?.trim();
    const relativePath = normalizeWorkspaceRelativePath(item.file.relativePath);
    const idMatch = artifactId ? byArtifactId.get(artifactId) : undefined;
    const pathMatch = relativePath
      ? byRelativePath.get(relativePath)
      : undefined;

    // Conflicting or ambiguous resolver identities must fail closed.
    if (idMatch === null || pathMatch === null) return item;
    if (idMatch && pathMatch && idMatch.path !== pathMatch.path) return item;

    const match = idMatch || pathMatch;
    if (!match) return item;
    if (
      artifactId &&
      match.artifactId &&
      artifactId !== match.artifactId.trim()
    ) {
      return item;
    }

    return {
      ...item,
      previewable: true,
      file: {
        ...item.file,
        ...match,
        name: item.file.name || match.name,
        type: item.file.type || match.type,
        path: match.path || item.file.path,
        relativePath:
          relativePath ||
          normalizeWorkspaceRelativePath(match.relativePath) ||
          undefined,
        artifactId: artifactId || match.artifactId,
        artifactChange: item.file.artifactChange,
        mimeType: item.file.mimeType || match.mimeType,
      },
    };
  });
}

export function isProgressDone(task: TaskInfo): boolean {
  return (
    task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED
  );
}
