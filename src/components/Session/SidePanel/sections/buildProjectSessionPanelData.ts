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
import { httpUrlOrNull } from '@/lib/richText';
import { AgentStep, TaskStatus } from '@/types/constants';
import {
  buildContextItems,
  extractLoadedSkillNames,
  normalizeContextKey,
  resolveContextConnector,
  type ContextConnector,
  type ContextSkill,
} from './buildContextItems';
import {
  collectSidePanelOutputFiles,
  mergeSidePanelOutputFiles,
} from './collectSidePanelOutputFiles';
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
  sourceAgent?: Agent;
}

export interface SessionToolCall {
  id: string;
  toolkitName: string;
  method: string;
  input: string;
  output: string;
  status: 'running' | 'done';
  taskId: string;
  agentName: string;
  createdAt: number;
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

/** Project-wide data consumed by the unified SidePanel. */
export interface ProjectSessionPanelData {
  agents: SessionAgentItem[];
  contextItems: SessionContextItem[];
  environments: SessionEnvironmentItem[];
  files: SessionFileItem[];
  progress: SessionProgressItem[];
  resources: SessionResourceItem[];
  toolCalls: SessionToolCall[];
}

function normalizeMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function eventTime(event: AgentMessage, fallback: number, sequence: number) {
  if (typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)) {
    return event.timestamp < 1_000_000_000_000
      ? event.timestamp * 1000
      : event.timestamp;
  }
  if (event.created_at) {
    const parsed = Date.parse(event.created_at);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback + sequence;
}

export function collectSessionToolCalls(
  runs: ProjectSessionRun[]
): SessionToolCall[] {
  const calls: SessionToolCall[] = [];
  let sequence = 0;

  for (const run of [...runs].reverse()) {
    for (const agent of run.task.taskAssigning ?? []) {
      const openByPair = new Map<string, SessionToolCall[]>();
      for (const event of agent.log ?? []) {
        if (
          event.step !== AgentStep.ACTIVATE_TOOLKIT &&
          event.step !== AgentStep.DEACTIVATE_TOOLKIT
        ) {
          continue;
        }
        const toolkitName = String(event.data?.toolkit_name ?? '').trim();
        if (!toolkitName || toolkitName.toLowerCase() === 'notice') continue;
        const method = String(event.data?.method_name ?? '').trim();
        const message = normalizeMessage(event.data?.message).trim();
        const pair = `${normalizeContextKey(toolkitName)}:${method
          .toLowerCase()
          .replace(/_/g, ' ')}`;

        if (event.step === AgentStep.ACTIVATE_TOOLKIT) {
          const call: SessionToolCall = {
            id: `${run.taskId}:${agent.agent_id}:${sequence}`,
            toolkitName,
            method,
            input: message,
            output: '',
            status: 'running',
            taskId: run.taskId,
            agentName: agent.name,
            createdAt: eventTime(event, run.createdAt, sequence),
            skillNames:
              normalizeContextKey(toolkitName) === 'skill'
                ? extractLoadedSkillNames(message)
                : [],
          };
          sequence += 1;
          calls.push(call);
          const pending = openByPair.get(pair) ?? [];
          pending.push(call);
          openByPair.set(pair, pending);
          continue;
        }

        const pending = openByPair.get(pair) ?? [];
        const call = [...pending]
          .reverse()
          .find((item) => item.status === 'running');
        if (call) {
          call.output = [call.output, message].filter(Boolean).join('\n\n');
          call.status = 'done';
          continue;
        }

        calls.push({
          id: `${run.taskId}:${agent.agent_id}:${sequence}`,
          toolkitName,
          method,
          input: '',
          output: message,
          status: 'done',
          taskId: run.taskId,
          agentName: agent.name,
          createdAt: eventTime(event, run.createdAt, sequence),
          skillNames: [],
        });
        sequence += 1;
      }
    }
  }

  return calls.sort((a, b) => a.createdAt - b.createdAt);
}

function mergeSubtasks(run: ProjectSessionRun): TaskInfo[] {
  const { task } = run;
  const singleAgent = task.taskAssigning.find(
    (agent) => agent.type === 'single_agent'
  );
  const base =
    singleAgent?.tasks?.length && singleAgent.tasks.length > 0
      ? singleAgent.tasks
      : task.taskInfo;
  const liveById = new Map(
    task.taskRunning.map((item) => [item.id, item] as const)
  );
  const merged = base.map((item) => {
    const live = liveById.get(item.id);
    return live
      ? { ...item, ...live, content: item.content || live.content }
      : item;
  });
  for (const live of task.taskRunning) {
    if (!merged.some((item) => item.id === live.id)) merged.push(live);
  }
  return merged.filter((item) => item.content.trim() !== '');
}

function selectedToolNames(agent: Agent): string[] {
  const names = new Set(agent.tools ?? []);
  const selected = agent.workerInfo?.selectedTools;
  if (Array.isArray(selected)) {
    for (const value of selected) {
      if (typeof value === 'string') {
        names.add(value);
      } else if (value && typeof value === 'object') {
        const item = value as { name?: string; key?: string; toolkit?: string };
        const name = item.name ?? item.key ?? item.toolkit;
        if (name) names.add(name);
      }
    }
  }
  return [...names];
}

function extractJsonString(input: string, key: string): string | null {
  try {
    const parsed = JSON.parse(input);
    const value = parsed?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    const match = input.match(
      new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`, 'i')
    );
    return match?.[1]?.trim() || null;
  }
}

function collectAgents(
  runs: ProjectSessionRun[],
  calls: SessionToolCall[]
): SessionAgentItem[] {
  const items = new Map<string, SessionAgentItem>();

  for (const run of runs) {
    for (const agent of run.task.taskAssigning ?? []) {
      const displayName = agent.workerInfo?.name || agent.name;
      const key = `${agent.type}:${displayName.trim().toLowerCase()}`;
      const existing = items.get(key);
      if (existing) {
        existing.createdAt = Math.max(existing.createdAt, run.createdAt);
        existing.updatedAt = Math.max(existing.updatedAt, run.updatedAt);
        if (!run.isCurrent || !existing.historical) continue;
      }
      items.set(key, {
        id: key,
        name: displayName,
        type: agent.type,
        description: agent.workerInfo?.description || '',
        tools: selectedToolNames(agent),
        historical: !run.isCurrent,
        createdAt: Math.max(existing?.createdAt ?? 0, run.createdAt),
        updatedAt: Math.max(existing?.updatedAt ?? 0, run.updatedAt),
        subagent: false,
        sourceAgent: agent,
      });
    }
  }

  for (const call of calls) {
    const normalized = `${call.toolkitName} ${call.method}`
      .toLowerCase()
      .replace(/[_-]/g, ' ');
    if (!normalized.includes('sub agent') && !normalized.includes('subagent')) {
      continue;
    }
    const owningRun = runs.find((run) => run.taskId === call.taskId);
    const remoteName = extractJsonString(call.input, 'remote_agent_name') || '';
    const key = `subagent:${remoteName.toLowerCase() || 'remote-subagent'}`;
    const existing = items.get(key);
    const createdAt = Math.max(
      existing?.createdAt ?? 0,
      owningRun?.createdAt ?? call.createdAt
    );
    const updatedAt = Math.max(
      existing?.updatedAt ?? 0,
      call.createdAt,
      owningRun?.updatedAt ?? 0
    );
    if (existing && !existing.historical) {
      existing.createdAt = createdAt;
      existing.updatedAt = updatedAt;
      continue;
    }
    items.set(key, {
      id: key,
      name: remoteName,
      type: 'subagent',
      description: extractJsonString(call.input, 'instruction') || '',
      tools: [],
      historical: !owningRun?.isCurrent,
      createdAt,
      updatedAt,
      subagent: true,
    });
  }

  return [...items.values()].sort(
    (a, b) =>
      Number(a.historical) - Number(b.historical) ||
      Number(a.subagent) - Number(b.subagent)
  );
}

function uploadedFiles(run: ProjectSessionRun): File[] {
  const all = [
    ...run.task.messages
      .filter((message) => message.role === 'user')
      .flatMap((message) => message.attaches ?? []),
    ...(run.task.attaches ?? []),
  ];
  const seen = new Set<string>();
  return all.filter((file) => {
    if (!file.filePath || seen.has(file.filePath)) return false;
    seen.add(file.filePath);
    return true;
  });
}

function callMatchesContext(
  call: SessionToolCall,
  item: ContextItem,
  connectors: ContextConnector[]
): boolean {
  if (item.category === 'skill') {
    const itemKey = normalizeContextKey(item.label);
    return call.skillNames.some(
      (name) => normalizeContextKey(name) === itemKey
    );
  }
  if (item.category === 'connector') {
    const connector = resolveContextConnector(
      call.toolkitName,
      call.method,
      call.input,
      connectors
    );
    if (connector) {
      return (
        normalizeContextKey(connector.service) ===
          normalizeContextKey(item.id) ||
        normalizeContextKey(connector.displayName || connector.service) ===
          normalizeContextKey(item.label)
      );
    }
    return (
      normalizeContextKey(call.toolkitName) ===
      normalizeContextKey(item.label || item.id)
    );
  }
  return false;
}

function collectContext(
  runs: ProjectSessionRun[],
  calls: SessionToolCall[],
  skills: ContextSkill[],
  connectors: ContextConnector[]
): SessionContextItem[] {
  const items = new Map<string, SessionContextItem>();
  for (const run of runs) {
    const runItems = buildContextItems(
      run.task.taskAssigning,
      run.task.taskRunning,
      uploadedFiles(run),
      skills,
      connectors
    ).filter(
      (
        item
      ): item is ContextItem & { category: Exclude<ContextCategory, 'file'> } =>
        item.category !== 'file'
    );
    for (const item of runItems) {
      const key = `${item.category}:${normalizeContextKey(item.label)}`;
      const itemCalls = calls.filter((call) =>
        callMatchesContext(call, item, connectors)
      );
      const existing = items.get(key);
      if (existing) {
        existing.calls = Array.from(
          new Map(
            [...existing.calls, ...itemCalls].map((call) => [call.id, call])
          ).values()
        );
        if (run.isCurrent) existing.historical = false;
        existing.createdAt = Math.max(existing.createdAt, run.createdAt);
        existing.updatedAt = Math.max(existing.updatedAt, run.updatedAt);
        continue;
      }
      items.set(key, {
        ...item,
        historical: !run.isCurrent,
        createdAt: run.createdAt,
        updatedAt: Math.max(
          run.updatedAt,
          ...itemCalls.map((call) => call.createdAt)
        ),
        calls: itemCalls,
      });
    }
  }
  return [...items.values()].sort(
    (a, b) => Number(a.historical) - Number(b.historical)
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

function collectResources(
  runs: ProjectSessionRun[],
  calls: SessionToolCall[]
): SessionResourceItem[] {
  const resources = new Map<string, SessionResourceItem>();
  const outputPaths = new Set(
    runs.flatMap((run) =>
      collectSidePanelOutputFiles(run.task).flatMap((file) => [
        file.path,
        file.relativePath ?? '',
      ])
    )
  );

  const put = (item: SessionResourceItem) => {
    const existing = resources.get(item.id);
    if (existing) {
      item.createdAt = Math.max(item.createdAt, existing.createdAt);
      item.updatedAt = Math.max(item.updatedAt, existing.updatedAt);
    }
    if (!existing || (existing.historical && !item.historical)) {
      resources.set(item.id, item);
    } else if (existing) {
      existing.updatedAt = item.updatedAt;
    }
  };

  for (const run of runs) {
    for (const entry of run.task.webViewUrls ?? []) {
      const urls = extractHttpUrls(entry.url);
      for (const url of urls) {
        put({
          id: `url:${url}`,
          label: resourceLabel(url),
          kind: 'url',
          url,
          taskId: run.taskId,
          historical: !run.isCurrent,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        });
      }
    }

    for (const file of uploadedFiles(run)) {
      if (outputPaths.has(file.filePath)) continue;
      const asUrl = httpUrlOrNull(file.filePath);
      if (asUrl) {
        put({
          id: `url:${asUrl}`,
          label: file.fileName || resourceLabel(asUrl),
          kind: 'url',
          url: asUrl,
          taskId: run.taskId,
          historical: !run.isCurrent,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        });
      } else {
        put({
          id: `file:${file.filePath}`,
          label:
            file.fileName || file.filePath.split('/').pop() || file.filePath,
          kind: 'file',
          file: {
            name: file.fileName,
            path: file.filePath,
            type: file.fileName.split('.').pop() || '',
          },
          taskId: run.taskId,
          historical: !run.isCurrent,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        });
      }
    }
  }

  for (const call of calls) {
    const run = runs.find((candidate) => candidate.taskId === call.taskId);
    for (const url of extractHttpUrls(`${call.input}\n${call.output}`)) {
      put({
        id: `url:${url}`,
        label: resourceLabel(url),
        kind: 'url',
        url,
        taskId: call.taskId,
        historical: !run?.isCurrent,
        createdAt: run?.createdAt ?? call.createdAt,
        updatedAt: Math.max(call.createdAt, run?.updatedAt ?? 0),
      });
    }
  }

  return [...resources.values()].sort(
    (a, b) => Number(a.historical) - Number(b.historical)
  );
}

function collectFiles(runs: ProjectSessionRun[]): SessionFileItem[] {
  const files = new Map<string, SessionFileItem>();
  for (const run of runs) {
    for (const file of collectSidePanelOutputFiles(run.task)) {
      const key = file.relativePath || file.path || file.name;
      if (!key) continue;
      const existing = files.get(key);
      if (existing) {
        existing.createdAt = Math.max(existing.createdAt, run.createdAt);
        existing.updatedAt = Math.max(existing.updatedAt, run.updatedAt);
      }
      if (!existing || (existing.historical && run.isCurrent)) {
        files.set(key, {
          id: key,
          file,
          taskId: run.taskId,
          historical: !run.isCurrent,
          createdAt: Math.max(existing?.createdAt ?? 0, run.createdAt),
          updatedAt: Math.max(existing?.updatedAt ?? 0, run.updatedAt),
        });
      }
    }
  }
  return [...files.values()].sort(
    (a, b) => Number(a.historical) - Number(b.historical)
  );
}

function collectEnvironments(
  runs: ProjectSessionRun[],
  calls: SessionToolCall[]
): SessionEnvironmentItem[] {
  const environments = new Map<string, SessionEnvironmentItem>();
  const put = (
    label: string,
    taskId: string,
    historical: boolean,
    createdAt: number,
    updatedAt: number
  ) => {
    const id = label.toLowerCase();
    const existing = environments.get(id);
    const latestCreation = Math.max(existing?.createdAt ?? 0, createdAt);
    const latestUpdate = Math.max(existing?.updatedAt ?? 0, updatedAt);
    if (!existing || (existing.historical && !historical)) {
      environments.set(id, {
        id,
        label,
        taskId,
        historical,
        createdAt: latestCreation,
        updatedAt: latestUpdate,
      });
    } else {
      existing.createdAt = latestCreation;
      existing.updatedAt = latestUpdate;
    }
  };

  for (const run of runs) {
    if (run.task.webViewUrls.length > 0) {
      put('Browser', run.taskId, !run.isCurrent, run.createdAt, run.updatedAt);
    }
    const hasTerminal = run.task.taskAssigning.some((agent) =>
      agent.tasks.some((task) => (task.terminal?.length ?? 0) > 0)
    );
    if (hasTerminal) {
      put('Terminal', run.taskId, !run.isCurrent, run.createdAt, run.updatedAt);
    }
  }

  for (const call of calls) {
    const run = runs.find((candidate) => candidate.taskId === call.taskId);
    const normalized = `${call.toolkitName} ${call.method}`.toLowerCase();
    if (/browser|search|scrape/.test(normalized)) {
      put(
        'Browser',
        call.taskId,
        !run?.isCurrent,
        run?.createdAt ?? call.createdAt,
        Math.max(call.createdAt, run?.updatedAt ?? 0)
      );
    }
    if (/terminal|shell|code execution/.test(normalized)) {
      put(
        'Terminal',
        call.taskId,
        !run?.isCurrent,
        run?.createdAt ?? call.createdAt,
        Math.max(call.createdAt, run?.updatedAt ?? 0)
      );
    }
    if (/sub.?agent|remote/.test(normalized)) {
      put(
        'Remote environment',
        call.taskId,
        !run?.isCurrent,
        run?.createdAt ?? call.createdAt,
        Math.max(call.createdAt, run?.updatedAt ?? 0)
      );
    }
  }

  return [...environments.values()].sort(
    (a, b) => Number(a.historical) - Number(b.historical)
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
    environments: collectEnvironments(runs, toolCalls),
    files: collectFiles(runs),
    progress: runs.flatMap((run) =>
      mergeSubtasks(run).map((task) => ({
        key: `${run.taskId}:${task.id}`,
        task,
        taskId: run.taskId,
        historical: !run.isCurrent,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }))
    ),
    resources: collectResources(runs, toolCalls),
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
      items.find((item) => item.id === id) ?? {
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
