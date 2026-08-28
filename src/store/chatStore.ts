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

import {
  fetchDelete,
  fetchGet,
  fetchPost,
  fetchPut,
  getBaseURL,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
  sseTransport,
  uploadFile,
  waitForBackendReady,
} from '@/api/http';
import { showCreditsToast } from '@/components/Toast/creditsToast';
import { showStorageToast } from '@/components/Toast/storageToast';
import type { AppHost } from '@/host/types';
import { generateUniqueId, uploadLog } from '@/lib';
import {
  classifyError,
  classifyTaskCategory,
} from '@/lib/events/appEventClassifiers';
import {
  recordFeatureUsed,
  recordTaskCompleted,
  recordTaskFailed,
  recordTaskStopped,
  recordTaskSubmitted,
} from '@/lib/events/appEvents';
import { notifyDurableRunStatusChanged } from '@/lib/events/durableRunEvents';
import {
  buildAgentModelConfigFromProvider,
  splitProviderConfig,
} from '@/lib/modelConfig';
import {
  normalizeRemoteSubAgentProvider,
  REMOTE_SUB_AGENT_PROVIDER_ID,
  toRemoteSubAgentRuntimeConfig,
} from '@/lib/remoteSubAgent';
import { runEventIngressRegistry } from '@/lib/runEvents';
import { buildSearchRuntimeConfig } from '@/lib/searchConfig';
import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import { settleTaskElapsedMs } from '@/lib/taskDuration';
import { cancelFollowUpRequest } from '@/service/followUpQueueApi';
import { proxyUpdateTriggerExecution } from '@/service/triggerApi';
import { ExecutionStatus } from '@/types';
import {
  AgentMessageStatus,
  AgentStatusValue,
  AgentStep,
  ChatTaskStatus,
  SessionMode,
  TaskStatus,
  type ChatTaskStatusType,
  type SessionModeType,
} from '@/types/constants';
import i18next from 'i18next';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { createStore } from 'zustand';
import { getAuthStore, getWorkerList } from './authStore';
import { enqueueChatEventProjection } from './chatEventProjectionBridge';
import {
  cloudModelRequestExtraParams,
  getCloudModelStore,
} from './cloudModelStore';
import { usePageTabStore } from './pageTabStore';
import { useProjectStore } from './projectStore';
import { getServerCapabilityStore } from './serverCapabilityStore';
import { legacySpaceIdForUser, useSpaceStore } from './spaceStore';

const API_CODE_TRIAL_LIMIT = '22';
const CONNECTOR_GATEWAY_MCP_NAME = 'connector_gateway';
const PROJECT_CONTEXT_MAX_CHARS = 24_000;
const PROJECT_CONTEXT_MAX_RUNS = 8;
// chat_history.summary is a bounded database column; an over-long value
// makes the whole history update fail server-side, which also discards the
// status change carried by the same request (a completed run then stays
// "ongoing"). Clamp before sending; the full text still lives in the run's
// end step.
const MAX_CHAT_HISTORY_SUMMARY_LENGTH = 1024;

export async function admitDurableRunResume(
  runId: string,
  requestId: string,
  post: typeof fetchPost = fetchPost
): Promise<void> {
  await post(`/runs/${encodeURIComponent(runId)}/resume`, {
    request_id: requestId,
    reason: 'explicit_resume',
  });
}

/** Adapt a canonical RunEvent to the legacy message reducer during migration. */
export const canonicalRunEventToLegacyMessage = (
  value: unknown
): AgentMessage | null => {
  if (!value || typeof value !== 'object') return null;
  const event = value as {
    event_type?: unknown;
    legacy_step?: unknown;
    payload?: unknown;
    created_at?: unknown;
  };
  // Approval decisions are canonical-only events. Project their durable
  // interaction id into the legacy reducer so reconnect/replay closes the
  // corresponding ASK card instead of resurrecting an already-decided card.
  if (
    event.event_type === 'approval.decided' ||
    event.event_type === 'interaction.resolved'
  ) {
    const payload =
      event.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : null;
    if (typeof payload?.interaction_id !== 'string') return null;
    return {
      step: AgentStep.HUMAN_REPLY,
      data: {
        ...payload,
        __durable_interaction_resolution: true,
      },
      timestamp:
        typeof event.created_at === 'number' &&
        Number.isFinite(event.created_at)
          ? event.created_at
          : undefined,
    } as AgentMessage;
  }
  if (event.event_type === 'run.failed') {
    const payload =
      event.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : null;
    return {
      step: AgentStep.ERROR,
      data: {
        message:
          typeof payload?.message === 'string' && payload.message.trim()
            ? payload.message
            : i18next.t('chat.run-no-final-response', {
                defaultValue:
                  'This task failed before it produced a final response.',
              }),
        error_type:
          typeof payload?.error_type === 'string'
            ? payload.error_type
            : undefined,
      },
      timestamp:
        typeof event.created_at === 'number' &&
        Number.isFinite(event.created_at)
          ? event.created_at
          : undefined,
    } as AgentMessage;
  }
  if (event.event_type === 'artifact.manifest.finalized') {
    const payload =
      event.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : null;
    if (!payload || !Array.isArray(payload.artifacts)) return null;
    return {
      step: AgentStep.ARTIFACT_MANIFEST,
      data: payload,
      timestamp:
        typeof event.created_at === 'number' &&
        Number.isFinite(event.created_at)
          ? event.created_at
          : undefined,
    } as AgentMessage;
  }
  if (event.event_type === 'artifact.uploaded') {
    const payload =
      event.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : null;
    if (!payload || typeof payload.artifact_id !== 'string') return null;
    return {
      step: AgentStep.ARTIFACT_UPLOADED,
      data: payload,
      timestamp:
        typeof event.created_at === 'number' &&
        Number.isFinite(event.created_at)
          ? event.created_at
          : undefined,
    } as AgentMessage;
  }
  if (typeof event.legacy_step !== 'string' || !event.legacy_step) {
    return null;
  }
  return {
    step: event.legacy_step,
    data: event.payload,
    // Canonical Run events use epoch seconds. Preserve the durable event time
    // so history hydration measures the original execution instead of the
    // few milliseconds taken by local SSE replay.
    timestamp:
      typeof event.created_at === 'number' && Number.isFinite(event.created_at)
        ? event.created_at
        : undefined,
  } as AgentMessage;
};

/** Remove only the card resolved by a durable interaction decision. */
export function removeResolvedInteractionMessages(
  messages: Message[],
  interactionId: string
): Message[] {
  return messages.filter(
    (message) => message.interaction?.interaction_id !== interactionId
  );
}

/** At-least-once ASK delivery must be idempotent across live and replay lanes. */
export function hasProjectedHumanInteraction(
  task:
    | {
        messages: Message[];
        askList: Message[];
        resolvedInteractionIds?: string[];
      }
    | undefined,
  interactionId: string
): boolean {
  if (!task || !interactionId) return false;
  return (
    task.resolvedInteractionIds?.includes(interactionId) === true ||
    task.messages.some(
      (message) => message.interaction?.interaction_id === interactionId
    ) ||
    task.askList.some(
      (message) => message.interaction?.interaction_id === interactionId
    )
  );
}

export interface CanonicalRunEventCursor {
  lastSequence: number;
  recentEventIds: Set<string>;
  eventIdOrder: string[];
}

export interface LegacyChatProjectionCursor {
  runId: string;
  sourceId: string;
  sequence: number;
}

/**
 * Legacy `/chat` keeps one transport open while a Project advances through
 * multiple durable Runs. Synthetic projection identity must therefore rotate
 * with the Run, even though the network connection itself does not reconnect.
 */
export function createLegacyChatProjectionCursor(
  runId: string,
  sourceId = generateUniqueId()
): LegacyChatProjectionCursor {
  return { runId, sourceId, sequence: 0 };
}

export function advanceLegacyChatProjectionCursor(
  cursor: LegacyChatProjectionCursor,
  runId: string,
  sourceId?: string
): LegacyChatProjectionCursor {
  if (runId !== cursor.runId) {
    return { runId, sourceId: sourceId ?? generateUniqueId(), sequence: 1 };
  }
  return { ...cursor, sequence: cursor.sequence + 1 };
}

/**
 * Canonical replay envelopes carry the RunJournal sequence under `sequence`.
 * Accept the normalized aliases as well so imported/cached canonical events
 * keep their authoritative chronology. Legacy chat frames use the caller's
 * per-Run shadow projection sequence instead.
 */
export function resolveCanonicalTimelineSequence(
  value: unknown,
  fallback: number
): number {
  if (value && typeof value === 'object') {
    const envelope = value as {
      runSequence?: unknown;
      run_sequence?: unknown;
      sequence?: unknown;
    };
    for (const candidate of [
      envelope.runSequence,
      envelope.run_sequence,
      envelope.sequence,
    ]) {
      if (
        typeof candidate === 'number' &&
        Number.isInteger(candidate) &&
        candidate > 0
      ) {
        return candidate;
      }
    }
  }
  return fallback;
}

export function stampAgentMessageTimeline(
  message: AgentMessage,
  timelineSequence: number
): AgentMessage {
  return { ...message, timelineSequence };
}

/**
 * Resolve the exact legacy frame that starts a prepared follow-up Run.
 *
 * Single-agent continuations start with CONFIRMED. Workforce continuations
 * finish the preceding Run first, then emit NEW_TASK_STATE with the prepared
 * Run id; simple workforce answers may never emit CONFIRMED at all.
 */
export function resolveLegacyChatProjectionRunId(input: {
  step: unknown;
  currentRunId: string;
  nextRunId: string | null | undefined;
  eventTaskId?: unknown;
}): string {
  if (!input.nextRunId || input.nextRunId === input.currentRunId) {
    return input.currentRunId;
  }
  if (input.step === AgentStep.CONFIRMED) return input.nextRunId;
  if (
    input.step === AgentStep.NEW_TASK_STATE &&
    input.eventTaskId === input.nextRunId
  ) {
    return input.nextRunId;
  }
  return input.currentRunId;
}

const CANONICAL_EVENT_ID_WINDOW = 2048;

export function createCanonicalRunEventCursor(
  afterSequence = 0
): CanonicalRunEventCursor {
  return {
    lastSequence: Math.max(0, Math.trunc(afterSequence)),
    recentEventIds: new Set<string>(),
    eventIdOrder: [],
  };
}

/** Sequence is the primary replay boundary; event_id is defense in depth. */
export function acceptCanonicalRunEvent(
  cursor: CanonicalRunEventCursor,
  value: unknown,
  sseEventId?: unknown
): boolean {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as { sequence?: unknown; event_id?: unknown };
  const sequenceCandidate =
    typeof envelope.sequence === 'number'
      ? envelope.sequence
      : typeof sseEventId === 'string' && sseEventId.trim()
        ? Number(sseEventId)
        : NaN;
  const sequence = Number.isInteger(sequenceCandidate)
    ? sequenceCandidate
    : null;
  const eventId =
    typeof envelope.event_id === 'string' && envelope.event_id
      ? envelope.event_id
      : undefined;

  if (sequence === null && !eventId) return false;
  if (sequence !== null && sequence <= cursor.lastSequence) return false;
  if (eventId && cursor.recentEventIds.has(eventId)) return false;

  if (sequence !== null) cursor.lastSequence = sequence;
  if (eventId) {
    cursor.recentEventIds.add(eventId);
    cursor.eventIdOrder.push(eventId);
    if (cursor.eventIdOrder.length > CANONICAL_EVENT_ID_WINDOW) {
      const expired = cursor.eventIdOrder.shift();
      if (expired) cursor.recentEventIds.delete(expired);
    }
  }
  return true;
}

const clampHistorySummary = (
  value: string | undefined | null
): string | undefined =>
  typeof value === 'string'
    ? value.slice(0, MAX_CHAT_HISTORY_SUMMARY_LENGTH)
    : undefined;

type ConfirmedUserPromptSources = {
  lastMessageContent?: unknown;
  messageContent?: unknown;
  question?: unknown;
  isFollowUpConfirm: boolean;
};

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export function resolveConfirmedUserMessageContent({
  lastMessageContent,
  messageContent,
  question,
  isFollowUpConfirm,
}: ConfirmedUserPromptSources): string {
  const optimisticMessage = nonEmptyString(lastMessageContent);
  if (optimisticMessage) return optimisticMessage;

  const capturedStartMessage = nonEmptyString(messageContent);
  const eventQuestion = nonEmptyString(question);

  if (isFollowUpConfirm) {
    return eventQuestion || capturedStartMessage || '';
  }

  return capturedStartMessage || eventQuestion || '';
}

type ConfirmedTaskAppendDecision = {
  projectId?: string | null;
  question?: unknown;
  messageContent?: unknown;
  skipFirstConfirm: boolean;
  replaySource?: 'cloud' | 'local_durable';
};

/**
 * Legacy Project streams use later `confirmed` frames to start another Run.
 * A local durable stream is already scoped to exactly one immutable Run, so a
 * later `confirmed` frame represents another attempt (Resume) of that same
 * Run and must remain in the existing ChatStore task.
 */
export function shouldAppendTaskForConfirmedEvent({
  projectId,
  question,
  messageContent,
  skipFirstConfirm,
  replaySource,
}: ConfirmedTaskAppendDecision): boolean {
  if (skipFirstConfirm || replaySource === 'local_durable') return false;
  return Boolean(
    projectId && (nonEmptyString(question) || nonEmptyString(messageContent))
  );
}

const hasApiCode = (value: unknown, code: string) =>
  typeof value === 'object' &&
  value !== null &&
  String((value as { code?: unknown }).code) === code;

let _host: AppHost | null = null;

// Per-step request_usage tokens keyed by `${taskId}:${agentId}`; needed
// because deactivate_agent.tokens is zeroed under request-level reporting.
const requestUsageStepTokens = new Map<string, number>();

const clearRequestUsageStepTokens = (taskId: string) => {
  for (const key of requestUsageStepTokens.keys()) {
    if (key.startsWith(`${taskId}:`)) {
      requestUsageStepTokens.delete(key);
    }
  }
};

export function injectHost(host: AppHost | null): void {
  _host = host;
}

function normalizeServerApiBaseUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  const trimmed = url.replace(/\/$/, '');
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.endsWith('/api/v1')) {
    return trimmed;
  }

  return `${trimmed}/api/v1`;
}

function resolveSpaceIdForProject(
  projectId?: string | null
): string | undefined {
  const authStore = getAuthStore();
  const project = projectId
    ? useProjectStore.getState().getProjectById(projectId)
    : null;
  const spaceStore = useSpaceStore.getState();
  const activeSpace = spaceStore.getActiveSpace();
  const candidateSpaceId = project?.spaceId || activeSpace?.id || null;

  if (!candidateSpaceId) {
    return undefined;
  }

  if (
    candidateSpaceId === legacySpaceIdForUser('local') ||
    candidateSpaceId.startsWith('legacy_')
  ) {
    return undefined;
  }

  const candidateSpace = spaceStore.getSpaceById(candidateSpaceId);
  if (!candidateSpace) {
    return undefined;
  }

  const currentUserId =
    authStore.user_id === undefined || authStore.user_id === null
      ? null
      : String(authStore.user_id);
  if (
    currentUserId &&
    candidateSpace.userId &&
    String(candidateSpace.userId) !== currentUserId
  ) {
    return undefined;
  }

  return candidateSpaceId;
}

function getDirectServerApiBaseUrl(): string | undefined {
  if (import.meta.env.DEV) {
    return normalizeServerApiBaseUrl(
      import.meta.env.VITE_PROXY_URL || 'http://localhost:3001'
    );
  }

  return normalizeServerApiBaseUrl(import.meta.env.VITE_BASE_URL);
}

function hasMcpServers(config: any): boolean {
  return Boolean(
    config &&
    typeof config === 'object' &&
    config.mcpServers &&
    typeof config.mcpServers === 'object' &&
    Object.keys(config.mcpServers).length > 0
  );
}

function mergeMcpConfigs(...configs: any[]): {
  mcpServers: Record<string, any>;
} {
  const mcpServers: Record<string, any> = {};
  configs.forEach((config) => {
    if (!hasMcpServers(config)) {
      return;
    }
    Object.assign(mcpServers, config.mcpServers);
  });
  return { mcpServers };
}

async function buildConnectorGatewayMcpConfig(
  token?: string | null
): Promise<{ mcpServers: Record<string, any> } | null> {
  if (!token) {
    return null;
  }

  try {
    if (import.meta.env.VITE_USE_LOCAL_PROXY === 'true') {
      return null;
    }

    const capabilities =
      await getServerCapabilityStore().fetchCapabilities(false);
    if (capabilities.features.connector_gateway.enabled !== true) {
      return null;
    }
  } catch (error) {
    console.warn(
      'Failed to resolve Connector Gateway capability for MCP:',
      error
    );
    return null;
  }

  const serverApiBaseUrl = getDirectServerApiBaseUrl();
  if (!serverApiBaseUrl) {
    return null;
  }

  return {
    mcpServers: {
      [CONNECTOR_GATEWAY_MCP_NAME]: {
        type: 'streamable_http',
        url: `${serverApiBaseUrl}/connectors/mcp`,
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 180,
      },
    },
  };
}

function getHostElectronAPI() {
  return _host?.electronAPI ?? null;
}

function getHostIpcRenderer() {
  return _host?.ipcRenderer ?? null;
}

function includesBrowserAgent(workerList: Agent[]): boolean {
  return workerList.some((worker) => {
    if (worker.type === 'browser_agent' || worker.agent_id === 'browser_agent')
      return true;
    const tools = worker.workerInfo?.tools || worker.tools || [];
    return Array.isArray(tools) && tools.includes('Browser Toolkit');
  });
}

function shouldEnsureBrowserForRequest(
  workerList: Agent[],
  sessionMode: SessionModeType,
  messageContent?: string
): boolean {
  if (includesBrowserAgent(workerList)) return true;
  if (sessionMode !== SessionMode.SINGLE_AGENT) return false;

  const content = messageContent || '';
  const explicitBrowserIntent =
    /\b(?:browser agent|use\s+(?:the\s+)?browser|open\s+(?:the\s+)?(?:browser|url|page|website|site)|visit\s+(?:the\s+)?(?:url|page|website|site))\b/i;
  return /https?:\/\//i.test(content) || explicitBrowserIntent.test(content);
}

function getPersistedStepTimeMs(message: AgentMessage): number | null {
  if (
    typeof message.timestamp === 'number' &&
    Number.isFinite(message.timestamp)
  ) {
    return message.timestamp < 1_000_000_000_000
      ? message.timestamp * 1000
      : message.timestamp;
  }

  if (message.created_at) {
    const parsed = Date.parse(message.created_at);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

export async function resolveCdpBrowsersForRequest(
  shouldEnsureBrowser: boolean
): Promise<{
  browser_port?: number;
  cdp_browsers: any[];
}> {
  const ipc = getHostIpcRenderer();
  if (!ipc?.invoke) {
    return { cdp_browsers: [] };
  }

  const browser_port = Number(await ipc.invoke('get-browser-port'));
  if (!shouldEnsureBrowser) {
    return { browser_port, cdp_browsers: [] };
  }

  const embeddedRuntime = await ipc.invoke('get-embedded-browser-runtime');
  const embeddedTargets = Array.isArray(embeddedRuntime?.targets)
    ? embeddedRuntime.targets.filter(
        (target: any) =>
          typeof target?.url === 'string' && target.url.length > 0
      )
    : [];
  if (!embeddedRuntime?.targetAvailable || embeddedTargets.length === 0) {
    console.warn(
      'Electron embedded browser has no available Eigent-owned WebView target'
    );
    return { browser_port, cdp_browsers: [] };
  }

  const embeddedPort = Number(embeddedRuntime.port) || browser_port;
  return {
    browser_port: embeddedPort,
    cdp_browsers: embeddedTargets.map((target: any) => ({
      id: `electron-webview-${target.webContentsId ?? 'owned'}`,
      port: embeddedPort,
      endpoint: `http://127.0.0.1:${embeddedPort}`,
      isExternal: false,
      managedBy: 'electron',
      targetUrl: target.url,
    })),
  };
}

export type DurableRunDisplayStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_user'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'stopped';

interface Task {
  source: 'user' | 'trigger';
  sessionMode?: SessionModeType;
  messages: Message[];
  type: string;
  summaryTask: string;
  taskInfo: TaskInfo[];
  attaches: File[];
  taskRunning: TaskInfo[];
  taskAssigning: Agent[];
  fileList: FileInfo[];
  /** Files from the authoritative typed Artifact manifest during replay. */
  artifactManifestFiles?: FileInfo[];
  artifactManifestFinalized?: boolean;
  artifactManifestScanStatus?: string;
  artifactManifestTruncated?: boolean;
  webViewUrls: { url: string; processTaskId: string }[];
  activeAsk: string;
  askList: Message[];
  /**
   * Monotonic interaction projection. Once an interaction is resolved, an
   * at-least-once ASK replay must never resurrect its actionable card.
   */
  resolvedInteractionIds: string[];
  progressValue: number;
  isPending: boolean;
  activeWorkspace: string | null;
  hasMessages: boolean;
  activeAgent: string;
  status: ChatTaskStatusType;
  /** Canonical Run outcome used when projecting historical/non-happy turns. */
  durableRunStatus?: DurableRunDisplayStatus;
  taskTime: number;
  elapsed: number;
  tokens: number;
  hasWaitComfirm: boolean;
  cotList: string[];
  hasAddWorker: boolean;
  nuwFileNum: number;
  delayTime: number;
  selectedFile: FileInfo | null;
  snapshots: any[];
  snapshotsTemp: any[];
  isTakeControl: boolean;
  planDirty: boolean;
  autoConfirmDeadline: number | null;
  isContextExceeded?: boolean;
  // Streaming decompose text - stored separately to avoid frequent re-renders
  streamingDecomposeText: string;
  // Trigger execution ID for tracking trigger task completion
  executionId?: string;
  nextExecutionId?: string;
  /** Unix ms timestamp when this task was created — used for Run ordering. */
  createdAt: number;
}

type UploadFileSource = 'project_output' | 'camel_log' | 'user_upload';

interface UploadCandidate {
  path: string;
  name: string;
  uploadName: string;
  logicalPath: string;
  source: UploadFileSource;
  artifactId?: string;
}

interface UploadOutcome {
  success: boolean;
  fileName: string;
  source: UploadFileSource;
  artifactId?: string;
  response?: unknown;
  error?: unknown;
}

interface CamelLogUploadFile {
  path?: string;
  name?: string;
  isFolder?: boolean;
  relativePath?: string;
  source?: 'camel_log';
}

function getFileNameFromPath(filePath: string): string {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || 'file';
}

function isReadableLocalPath(filePath?: string): filePath is string {
  if (!filePath) return false;
  return !/^(https?:|file:|blob:|data:)/i.test(filePath);
}

function buildUploadLogicalPath(
  fileName: string,
  source: UploadFileSource,
  relativePath?: string
): string {
  if (source === 'camel_log') {
    return relativePath
      ? `${normalizeOutputPath(relativePath)}/${fileName}`
      : fileName;
  }

  return fileName;
}

export async function buildUploadRequestId(
  uploadTargetId: string,
  file: Pick<UploadCandidate, 'path' | 'source' | 'logicalPath'>
): Promise<string> {
  const identity = [
    'renderer-upload-v1',
    uploadTargetId,
    file.source,
    file.logicalPath,
    // The local path is never uploaded. Hashing it keeps two explicitly
    // attached same-named files distinct without leaking device identity.
    file.path,
  ].join('\0');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(identity)
  );
  return `renderer-upload-v1:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function syncProjectDisplayName(
  projectId: string | null | undefined,
  name?: string
) {
  const displayName = (name ?? '').trim();
  if (!projectId || !displayName) return;
  useSpaceStore.getState().updateProjectMeta(projectId, { name: displayName });
  useProjectStore.getState().updateProject(projectId, { name: displayName });
}

const compactContextText = (value?: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const stripSummaryTag = (value?: unknown) =>
  compactContextText(
    typeof value === 'string'
      ? value.replace(/<summary>.*?<\/summary>/gs, '')
      : ''
  );

function taskContextResult(task: Task): string {
  const summaryParts = (task.summaryTask || '').split('|');
  const summary = compactContextText(summaryParts[1] || summaryParts[0]);
  if (summary) return summary;

  const endMessage = [...task.messages]
    .reverse()
    .find((message) => message.step === AgentStep.END && message.content);
  if (endMessage) return stripSummaryTag(endMessage.content);

  const agentMessage = [...task.messages]
    .reverse()
    .find((message) => message.role === 'agent' && message.content);
  return compactContextText(agentMessage?.content);
}

export function extractEndPayloadText(endData: unknown): string {
  if (typeof endData === 'string') {
    return endData;
  }
  if (!endData || typeof endData !== 'object') {
    return '';
  }

  for (const key of ['message', 'content', 'result', 'summary']) {
    const value = (endData as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      return value;
    }
  }

  return '';
}

export function extractAgentMessageContent(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  if (!data || typeof data !== 'object') {
    return '';
  }

  for (const key of ['content', 'notice', 'answer', 'question']) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      return value;
    }
  }

  // Approval/question payloads are structured objects. Their UI is rendered
  // from `message.interaction`; never smuggle the object into the string-only
  // Message.content field through a TypeScript assertion.
  return '';
}

export function hasLegacyReplayUnavailableMessage(
  messages: Array<Pick<Message, 'role' | 'content'>>,
  localizedMessage: string
): boolean {
  return messages.some(
    (message) =>
      message.role === 'agent' &&
      typeof message.content === 'string' &&
      (message.content === localizedMessage ||
        message.content.includes('Unable to replay this legacy task'))
  );
}

function completedSubtaskReportFallback(task?: Task): string {
  if (!task) return '';

  const reports =
    task.taskAssigning
      ?.flatMap((agent) => agent.tasks || [])
      .map((subtask) => compactContextText(subtask.report))
      .filter(Boolean) || [];

  if (reports.length <= 1) {
    return reports[0] || '';
  }

  return reports
    .map((report, index) => `**Subtask ${index + 1}**\n${report}`)
    .join('\n\n');
}

export function resolveEndMessageText(
  rawEndPayload: string,
  messages: Message[],
  task?: Task
) {
  const summary = rawEndPayload.match(/<summary>(.*?)<\/summary>/s)?.[1];
  if (summary) return summary;

  if (rawEndPayload.trim()) {
    return rawEndPayload;
  }

  const agentSummaryEnd = messages.findLast(
    (message) => message.step === AgentStep.AGENT_SUMMARY_END
  );
  return agentSummaryEnd?.summary || completedSubtaskReportFallback(task);
}

export function buildProjectContinuationContext(
  projectId?: string | null,
  excludeTaskId?: string | null
): string | undefined {
  if (!projectId) return undefined;

  const projectStore = useProjectStore.getState();
  const runs: string[] = [];

  for (const { chatStore } of projectStore.getAllChatStores(projectId)) {
    const state = chatStore.getState();
    for (const [taskId, task] of Object.entries(state.tasks)) {
      if (taskId === excludeTaskId) continue;
      const userMessage = task.messages.find(
        (message) => message.role === 'user' && message.content
      );
      const request = compactContextText(userMessage?.content);
      const result = taskContextResult(task);
      if (!request && !result) continue;
      runs.push(
        [
          `Run ${runs.length + 1}:`,
          request ? `User request: ${request}` : '',
          result ? `Result: ${result}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      );
    }
  }

  if (runs.length === 0) return undefined;
  const selectedRuns = runs.slice(-PROJECT_CONTEXT_MAX_RUNS);
  const context = selectedRuns.join('\n\n');
  return context.length > PROJECT_CONTEXT_MAX_CHARS
    ? context.slice(context.length - PROJECT_CONTEXT_MAX_CHARS)
    : context;
}

export function collectTaskUploadFiles(
  camelLogFiles: CamelLogUploadFile[],
  messages: Message[],
  pendingAttaches: File[] = [],
  _taskOutputFiles: FileInfo[] = []
): UploadCandidate[] {
  const uploadCandidates: Array<
    Omit<UploadCandidate, 'uploadName' | 'logicalPath'> & {
      relativePath?: string;
    }
  > = [];

  // Diagnostics are deliberately isolated from project-folder discovery.
  // The Electron endpoint behind this list traverses only camel_logs.
  for (const file of camelLogFiles) {
    if (!file?.path || !file?.name || file.isFolder) continue;
    uploadCandidates.push({
      path: file.path,
      name: file.name,
      relativePath: file.relativePath,
      source: 'camel_log',
    });
  }

  // Canonical agent-generated Artifacts are uploaded by the Brain-owned
  // SQLite ArtifactUploadOutbox. Keeping that lane out of Renderer memory is
  // what makes upload + artifact.uploaded crash-recoverable. Selected-folder
  // files remain metadata-only and are never inferred as upload consent.

  // ChatBox attachments are the other explicit consent boundary. This does
  // not include files merely present in the selected folder.
  const attachmentFiles = [
    ...messages.flatMap((message) => message.attaches || []),
    ...pendingAttaches,
  ];

  for (const attachment of attachmentFiles) {
    if (!isReadableLocalPath(attachment?.filePath)) continue;
    uploadCandidates.push({
      path: attachment.filePath,
      name:
        attachment.fileName?.trim() || getFileNameFromPath(attachment.filePath),
      source: 'user_upload',
    });
  }

  const uniqueCandidates = new Map<string, UploadCandidate>();
  for (const file of uploadCandidates) {
    if (!uniqueCandidates.has(file.path)) {
      const { relativePath, ...rest } = file;
      const uploadName = getFileNameFromPath(file.name);
      uniqueCandidates.set(file.path, {
        ...rest,
        uploadName,
        logicalPath: buildUploadLogicalPath(
          uploadName,
          file.source,
          relativePath
        ),
      });
    }
  }

  return Array.from(uniqueCandidates.values());
}

async function uploadTaskFiles(
  files: UploadCandidate[],
  uploadTargetId: string
): Promise<UploadOutcome[]> {
  const results: UploadOutcome[] = [];
  const hostIpcRenderer = getHostIpcRenderer();

  for (const file of files) {
    try {
      if (!hostIpcRenderer?.invoke) {
        results.push({
          success: false,
          fileName: file.name,
          source: file.source,
          artifactId: file.artifactId,
          error: 'IPC renderer is unavailable',
        });
        continue;
      }
      const result = await hostIpcRenderer.invoke('read-file', file.path);
      if (!result.success || !result.data) {
        results.push({
          success: false,
          fileName: file.name,
          source: file.source,
          artifactId: file.artifactId,
          error: result.error || 'Failed to read file',
        });
        continue;
      }

      const formData = new FormData();
      const blob = new Blob([result.data], {
        type: 'application/octet-stream',
      });
      formData.append('file', blob, file.uploadName);
      // TODO(file): rename endpoint to use project_id
      formData.append('task_id', uploadTargetId);
      formData.append('source', file.source);
      formData.append('logical_path', file.logicalPath);
      formData.append(
        'client_request_id',
        await buildUploadRequestId(uploadTargetId, file)
      );

      const uploadResponse = await uploadFile(
        '/api/v1/chat/files/upload',
        formData
      );
      console.log('File uploaded successfully:', {
        fileName: file.uploadName,
        source: file.source,
        uploadTargetId,
        response: uploadResponse,
      });
      results.push({
        success: true,
        fileName: file.uploadName,
        source: file.source,
        artifactId: file.artifactId,
        response: uploadResponse,
      });
    } catch (error) {
      console.error('File upload failed:', file.uploadName, file.source, error);
      results.push({
        success: false,
        fileName: file.uploadName,
        source: file.source,
        artifactId: file.artifactId,
        error,
      });
    }
  }

  return results;
}

export interface StartTaskOptions {
  preserveTaskId?: boolean;
  skipHistoryCreate?: boolean;
  historyId?: string | number | null;
  /** Execute a new Attempt on an existing interrupted durable Run. */
  resumeRequestId?: string;
  /** Reconstruct replay UI from the canonical local RunJournal. */
  replaySource?: 'cloud' | 'local_durable';
  /** Resolve only after Brain has accepted the initial SSE request. */
  awaitAdmission?: boolean;
  /** Stable review handoffs durably admitted with this user message. */
  reviewHandoffIds?: string[];
  /**
   * Resolve a local durable replay once its persisted backlog is projected,
   * while keeping the live stream attached in the background.
   */
  detachReplayAfterCatchUp?: boolean;
}

export interface ReplayTaskOptions {
  /** Keep a non-terminal durable Run streaming after history is ready. */
  detachAfterCatchUp?: boolean;
}

export interface ChatStore {
  updateCount: number;
  activeTaskId: string | null;
  nextTaskId: string | null;
  tasks: { [key: string]: Task };
  create: (id?: string, type?: any) => string;
  /**
   * Replace a task's full state in one commit — used by the IDB-backed
   * project cache to skip the SSE replay path when we already have a
   * reconstructed final state from a previous session. Volatile fields
   * (pending/streaming/timers) are forced to safe defaults.
   */
  hydrateTask: (taskId: string, state: Task) => void;
  removeTask: (taskId: string) => void;
  stopTask: (taskId: string) => void;
  setStatus: (taskId: string, status: ChatTaskStatusType) => void;
  setDurableRunStatus: (
    taskId: string,
    status: DurableRunDisplayStatus | undefined
  ) => void;
  setActiveTaskId: (taskId: string) => void;
  setTaskSessionMode: (taskId: string, mode: SessionModeType) => void;
  replay: (
    taskId: string,
    question: string,
    time: number,
    projectId?: string,
    source?: 'cloud' | 'local_durable',
    options?: ReplayTaskOptions
  ) => Promise<void>;
  startTask: (
    taskId: string,
    type?: string,
    shareToken?: string,
    delayTime?: number,
    messageContent?: string,
    messageAttaches?: File[],
    executionId?: string,
    projectId?: string,
    sessionMode?: SessionModeType,
    options?: StartTaskOptions
  ) => Promise<void>;
  handleConfirmTask: (
    project_id: string,
    taskId: string,
    type?: string
  ) => void;
  addMessages: (taskId: string, messages: Message) => void;
  setMessages: (taskId: string, messages: Message[]) => void;
  updateMessage: (taskId: string, messageId: string, message: Message) => void;
  removeMessage: (taskId: string, messageId: string) => void;
  markHumanInteractionResolved: (taskId: string, interactionId: string) => void;
  setAttaches: (taskId: string, attaches: File[]) => void;
  setSummaryTask: (taskId: string, summaryTask: string) => void;
  setHasWaitComfirm: (taskId: string, hasWaitComfirm: boolean) => void;
  setTaskAssigning: (taskId: string, taskAssigning: Agent[]) => void;
  setTaskInfo: (taskId: string, taskInfo: TaskInfo[]) => void;
  setTaskRunning: (taskId: string, taskRunning: TaskInfo[]) => void;
  setActiveAsk: (taskId: string, agentName: string) => void;
  setActiveAskList: (taskId: string, message: Message[]) => void;
  addWebViewUrl: (
    taskId: string,
    webViewUrl: string,
    processTaskId: string
  ) => void;
  setWebViewUrls: (
    taskId: string,
    webViewUrls: { url: string; processTaskId: string }[]
  ) => void;
  setProgressValue: (taskId: string, progressValue: number) => void;
  computedProgressValue: (taskId: string) => void;
  setIsPending: (taskId: string, isPending: boolean) => void;
  addTerminal: (
    taskId: string,
    processTaskId: string,
    terminal: string
  ) => void;
  addFileList: (
    taskId: string,
    processTaskId: string,
    fileInfo: FileInfo
  ) => void;
  setFileList: (
    taskId: string,
    processTaskId: string,
    fileList: FileInfo[]
  ) => void;
  setActiveWorkspace: (taskId: string, activeWorkspace: string) => void;
  setActiveAgent: (taskId: string, agentName: string) => void;
  setHasMessages: (taskId: string, hasMessages: boolean) => void;
  getLastUserMessage: () => Message | null;
  addTaskInfo: () => void;
  updateTaskInfo: (index: number, content: string) => void;
  saveTaskInfo: () => void;
  deleteTaskInfo: (index: number) => void;
  setTaskTime: (taskId: string, taskTime: number) => void;
  setElapsed: (taskId: string, taskTime: number) => void;
  getFormattedTaskTime: (taskId: string) => string;
  addTokens: (taskId: string, tokens: number) => void;
  getTokens: (taskId: string) => number;
  setUpdateCount: () => void;
  setCotList: (taskId: string, cotList: string[]) => void;
  setHasAddWorker: (taskId: string, hasAddWorker: boolean) => void;
  setNuwFileNum: (taskId: string, nuwFileNum: number) => void;
  setDelayTime: (taskId: string, delayTime: number) => void;
  setType: (taskId: string, type: string) => void;
  setSelectedFile: (taskId: string, selectedFile: FileInfo | null) => void;
  setSnapshots: (taskId: string, snapshots: any[]) => void;
  setIsTakeControl: (taskId: string, isTakeControl: boolean) => void;
  setSnapshotsTemp: (taskId: string, snapshot: any) => void;
  setPlanDirty: (taskId: string, dirty: boolean) => void;
  setAutoConfirmDeadline: (taskId: string, deadline: number | null) => void;
  savePlan: (taskId: string) => Promise<void>;
  clearTasks: () => void;
  setIsContextExceeded: (taskId: string, isContextExceeded: boolean) => void;
  setNextTaskId: (taskId: string | null) => void;
  setStreamingDecomposeText: (taskId: string, text: string) => void;
  clearStreamingDecomposeText: (taskId: string) => void;
  setExecutionId: (taskId: string, executionId: string | undefined) => void;
  setTaskSource: (taskId: string, source: 'user' | 'trigger') => void;
  setNextExecutionId: (
    taskId: string,
    nextExecutionId: string | undefined
  ) => void;
}

export type VanillaChatStore = {
  getState: () => ChatStore;
  subscribe: (listener: (state: ChatStore) => void) => () => void;
};

// Track auto-confirm timers per task to avoid reusing stale timers across rounds
const autoConfirmTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const AUTO_CONFIRM_TIMEOUT_MS = 30000;

// Track active SSE connections for proper cleanup. `live` distinguishes
// real Brain runs from history/share playback streams.
const activeSSEControllers: Record<
  string,
  { controller: AbortController; live: boolean }
> = {};

const FINAL_OUTPUT_FILE_PATH_REGEX =
  /(?<![A-Za-z0-9:\\/])(?:[A-Za-z]:)?[\\/][^\s`"'<>|*]+?\.[A-Za-z0-9]{1,12}(?=$|[\s`"'<>|*),;:\]}])/g;

const FINAL_OUTPUT_SANDBOX_SCHEME_REGEX =
  /(^|[^A-Za-z0-9_+.-])sandbox:(?=(?:[A-Za-z]:)?[\\/])/gi;

const FINAL_OUTPUT_FILE_EXTENSIONS = new Set([
  'csv',
  'doc',
  'docx',
  'gif',
  'htm',
  'html',
  'jpeg',
  'jpg',
  'json',
  'log',
  'md',
  'pdf',
  'png',
  'ppt',
  'pptx',
  'svg',
  'tsv',
  'txt',
  'webp',
  'xls',
  'xlsx',
  'xml',
  'zip',
]);

function normalizeOutputPath(path: string): string {
  return path.replace(/\\/g, '/').trim();
}

function getOutputFileNameFromPath(path: string): string {
  return normalizeOutputPath(path).split('/').pop() || '';
}

function getFileTypeFromName(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  return extension === name.toLowerCase() ? '' : extension;
}

function getProjectRelativeFilePath(
  filePath: string,
  projectId?: string
): string | undefined {
  const normalizedPath = normalizeOutputPath(filePath);
  if (projectId) {
    const projectMarker = `/project_${projectId}/`;
    const projectIndex = normalizedPath.indexOf(projectMarker);
    if (projectIndex !== -1) {
      return normalizedPath.slice(projectIndex + projectMarker.length);
    }
  }

  return normalizedPath.match(/\/project_[^/]+\/(.+)$/)?.[1];
}

function buildRemoteFileInfoPath({
  baseURL,
  email,
  projectId,
  relativePath,
}: {
  baseURL?: string;
  email?: string;
  projectId?: string;
  relativePath?: string;
}): string | undefined {
  if (!baseURL || !email || !projectId || !relativePath) {
    return undefined;
  }

  const params = new URLSearchParams({
    path: relativePath,
    project_id: projectId,
    email,
  });

  return `${baseURL.replace(/\/$/, '')}/files/stream?${params.toString()}`;
}

export function extractFinalOutputFileList(
  content: string,
  projectId?: string,
  email?: string,
  baseURL?: string
): FileInfo[] {
  if (!content) {
    return [];
  }

  const fileInfos: FileInfo[] = [];
  const seen = new Set<string>();
  const parseableContent = content.replace(
    FINAL_OUTPUT_SANDBOX_SCHEME_REGEX,
    '$1'
  );

  for (const match of parseableContent.matchAll(FINAL_OUTPUT_FILE_PATH_REGEX)) {
    const filePath = normalizeOutputPath(match[0]);
    if (!filePath || filePath.startsWith('//') || filePath.includes('://')) {
      continue;
    }

    const name = getOutputFileNameFromPath(filePath);
    const type = getFileTypeFromName(name);
    if (!name || !FINAL_OUTPUT_FILE_EXTENSIONS.has(type)) {
      continue;
    }

    const relativePath = getProjectRelativeFilePath(filePath, projectId);
    const remotePath = buildRemoteFileInfoPath({
      baseURL,
      email,
      projectId,
      relativePath,
    });
    const identity = normalizeOutputPath(relativePath || filePath);
    if (seen.has(identity)) {
      continue;
    }

    seen.add(identity);
    fileInfos.push({
      name,
      type,
      path: remotePath || filePath,
      icon: FileText,
      relativePath,
      isRemote: Boolean(remotePath),
    });
  }

  return fileInfos;
}

type TaskArtifactChange = {
  artifact_id?: unknown;
  filename?: unknown;
  path?: unknown;
  relativePath?: unknown;
  changeType?: unknown;
  size?: unknown;
  modifiedAt?: unknown;
  uploadPolicy?: unknown;
  localPathAvailable?: unknown;
  asset_ref?: unknown;
};

/** Convert Brain's capability-protected local artifact index into preview cards. */
export function normalizeTaskArtifactFileList(value: unknown): FileInfo[] {
  if (!Array.isArray(value)) return [];

  const files: FileInfo[] = [];
  const seen = new Set<string>();
  for (const candidate of value as TaskArtifactChange[]) {
    const path =
      typeof candidate.path === 'string'
        ? normalizeOutputPath(candidate.path)
        : '';
    const name =
      typeof candidate.filename === 'string'
        ? candidate.filename.trim()
        : getOutputFileNameFromPath(path);
    const relativePath =
      typeof candidate.relativePath === 'string'
        ? normalizeOutputPath(candidate.relativePath)
        : undefined;
    const artifactId =
      typeof candidate.artifact_id === 'string'
        ? candidate.artifact_id.trim()
        : '';
    const type = getFileTypeFromName(name);
    const identity = (artifactId || relativePath || path).toLowerCase();
    if (!name || !identity || seen.has(identity)) continue;

    const asset =
      candidate.asset_ref && typeof candidate.asset_ref === 'object'
        ? (candidate.asset_ref as Record<string, unknown>)
        : null;
    const assetKey = typeof asset?.key === 'string' ? asset.key : undefined;

    seen.add(identity);
    files.push({
      name,
      type,
      path,
      relativePath,
      icon: FileText,
      isRemote: false,
      artifactId: artifactId || undefined,
      uploadPolicy:
        candidate.uploadPolicy === 'agent_generated'
          ? 'agent_generated'
          : candidate.uploadPolicy === 'metadata_only'
            ? 'metadata_only'
            : undefined,
      localPathAvailable:
        typeof candidate.localPathAvailable === 'boolean'
          ? candidate.localPathAvailable
          : Boolean(path),
      assetRef: assetKey
        ? {
            chatFileId:
              typeof asset?.chat_file_id === 'number'
                ? asset.chat_file_id
                : undefined,
            key: assetKey,
            bucket:
              typeof asset?.bucket === 'string' ? asset.bucket : undefined,
            filename:
              typeof asset?.filename === 'string' ? asset.filename : undefined,
            size: typeof asset?.size === 'number' ? asset.size : undefined,
            contentType:
              typeof asset?.content_type === 'string'
                ? asset.content_type
                : undefined,
          }
        : undefined,
      artifactChange:
        candidate.changeType === 'generated' ? 'generated' : 'changed',
      size:
        typeof candidate.size === 'number' && candidate.size >= 0
          ? candidate.size
          : undefined,
      modifiedAt:
        typeof candidate.modifiedAt === 'number'
          ? candidate.modifiedAt
          : undefined,
    });
  }
  return files;
}

type TaskArtifactFileListResult = {
  canonical: boolean;
  files: FileInfo[];
  scanStatus: string | null;
  truncated: boolean;
};

async function loadTaskArtifactFileList({
  taskId,
  projectId,
  email,
  userId,
}: {
  taskId: string;
  projectId?: string;
  email?: string;
  userId?: string | number | null;
}): Promise<TaskArtifactFileListResult> {
  // The index contains absolute local paths and is intentionally Desktop-only.
  if (!getHostIpcRenderer()?.invoke || !projectId || !email) {
    return {
      canonical: false,
      files: [],
      scanStatus: null,
      truncated: false,
    };
  }

  try {
    const response = await fetchGet('/files/changes', {
      task_id: taskId,
      project_id: projectId,
      email,
      ...(userId ? { user_id: userId } : {}),
    });
    const envelope =
      response && !Array.isArray(response) && typeof response === 'object'
        ? (response as Record<string, unknown>)
        : null;
    const changes = envelope?.artifacts ?? response;
    return {
      canonical: true,
      files: normalizeTaskArtifactFileList(changes),
      scanStatus:
        typeof envelope?.scan_status === 'string'
          ? envelope.scan_status
          : 'complete',
      truncated: envelope?.truncated === true,
    };
  } catch (error) {
    // Older Brain versions and cloud-only history do not expose the local
    // artifact index. Existing WRITE_FILE/final-answer projections remain.
    console.info(`[Artifacts] No local changes for task ${taskId}`, error);
    return {
      canonical: false,
      files: [],
      scanStatus: null,
      truncated: false,
    };
  }
}

function normalizedFileIdentity(value: string | undefined): string {
  if (!value) return '';

  let identity = normalizeOutputPath(value);
  const queryIndex = identity.indexOf('?');
  if (queryIndex !== -1) {
    try {
      const remoteUrl = new URL(identity, 'http://eigent.local');
      const streamedPath = remoteUrl.searchParams.get('path');
      if (streamedPath) identity = normalizeOutputPath(streamedPath);
    } catch {
      // Keep the original value when it is not a valid URL-shaped path.
    }
  }

  // Older Desktop builds accidentally prefixed POSIX sandbox paths with a
  // synthetic `x:` drive. It is identity noise, not part of the real path.
  return identity.replace(/^x:(?=\/)/i, '').toLowerCase();
}

function pathEndsWithRelativePath(
  absoluteOrRemotePath: string,
  relativePath: string
): boolean {
  return (
    absoluteOrRemotePath === relativePath ||
    absoluteOrRemotePath.endsWith(`/${relativePath.replace(/^\/+/, '')}`)
  );
}

function fileInfoMatches(left: FileInfo, right: FileInfo): boolean {
  const leftPath = normalizedFileIdentity(left.path);
  const rightPath = normalizedFileIdentity(right.path);
  const leftRelative = normalizedFileIdentity(left.relativePath);
  const rightRelative = normalizedFileIdentity(right.relativePath);

  if (leftRelative && rightRelative && leftRelative === rightRelative) {
    return true;
  }
  if (leftPath && rightPath && leftPath === rightPath) return true;
  if (
    leftRelative &&
    rightPath &&
    pathEndsWithRelativePath(rightPath, leftRelative)
  ) {
    return true;
  }
  if (
    rightRelative &&
    leftPath &&
    pathEndsWithRelativePath(leftPath, rightRelative)
  ) {
    return true;
  }

  // Name-only rows are legacy data with no path identity. Use the basename
  // only when neither side has enough path information to distinguish files.
  if (!leftPath && !rightPath && !leftRelative && !rightRelative) {
    return (
      normalizedFileIdentity(left.name) === normalizedFileIdentity(right.name)
    );
  }
  return false;
}

function isLegacySandboxDrivePath(
  existingPath: string,
  extractedPath: string
): boolean {
  const normalizedExisting = normalizeOutputPath(existingPath).toLowerCase();
  const normalizedExtracted = normalizeOutputPath(extractedPath).toLowerCase();
  return normalizedExisting === `x:${normalizedExtracted}`;
}

export function mergeFileInfoLists(
  existingFileList: FileInfo[],
  extractedFileList: FileInfo[]
): FileInfo[] {
  const merged = [...existingFileList];

  extractedFileList.forEach((file) => {
    const existingIndex = merged.findIndex((existing) =>
      fileInfoMatches(existing, file)
    );

    if (existingIndex === -1) {
      merged.push(file);
      return;
    }

    const existingFile = merged[existingIndex];
    if (
      (file.isRemote && !existingFile.isRemote) ||
      isLegacySandboxDrivePath(existingFile.path, file.path)
    ) {
      merged[existingIndex] = {
        ...existingFile,
        ...file,
      };
      return;
    }

    if (
      (file.artifactChange && !existingFile.artifactChange) ||
      (file.size !== undefined && existingFile.size === undefined) ||
      (file.modifiedAt !== undefined && existingFile.modifiedAt === undefined)
    ) {
      merged[existingIndex] = {
        ...existingFile,
        artifactChange: existingFile.artifactChange || file.artifactChange,
        relativePath: existingFile.relativePath || file.relativePath,
        size: existingFile.size ?? file.size,
        modifiedAt: existingFile.modifiedAt ?? file.modifiedAt,
      };
    }
  });

  return merged;
}

/**
 * Resolve the final card's Run-scoped output list.
 *
 * A successful local artifact lookup is authoritative even when it returns an
 * empty list. In that case paths merely mentioned in the final answer must not
 * be promoted to "Files changed": they can point at files created by an older
 * Run in the same direct-write workspace. Final-answer extraction remains a
 * compatibility fallback for cloud history and older Brain versions that do
 * not expose the canonical artifact endpoint.
 */
export function resolveRunOutputFileList({
  writeEventFiles,
  artifactFiles,
  canonicalArtifactsAvailable,
  finalAnswerFiles,
}: {
  writeEventFiles: FileInfo[];
  artifactFiles: FileInfo[];
  canonicalArtifactsAvailable: boolean;
  finalAnswerFiles: FileInfo[];
}): FileInfo[] {
  return mergeFileInfoLists(
    writeEventFiles,
    canonicalArtifactsAvailable ? artifactFiles : finalAnswerFiles
  );
}

const normalizeToolkitMessage = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const isSingleAgentEventName = (value: unknown) =>
  typeof value === 'string' &&
  (value === 'single_agent' ||
    value === 'Agents.single_agent' ||
    value.endsWith('.single_agent'));

const ensureSingleAgentAssignment = (
  taskAssigning: Agent[],
  taskId: string,
  agentId?: string
) => {
  const existingIndex = taskAssigning.findIndex(
    (agent) => agent.type === 'single_agent'
  );
  if (existingIndex !== -1) return existingIndex;
  taskAssigning.push({
    agent_id: agentId || `${taskId}-single-agent`,
    name: 'CAMEL Agent',
    type: 'single_agent',
    status: AgentStatusValue.RUNNING,
    tasks: [],
    log: [],
  });
  return taskAssigning.length - 1;
};

/** Persist subtask edits to backend via PUT /task/{project_id}. */
const persistSubtaskEdits = async (taskInfo: TaskInfo[]) => {
  const projectId = useProjectStore.getState().activeProjectId;
  if (!projectId) return;

  const nonEmpty = taskInfo.filter((t) => t.content !== '');
  await fetchPut(`/task/${projectId}`, { task: nonEmpty });
};

const resolveProcessTaskIdForToolkitEvent = (
  tasksById: Record<string, Task>,
  currentTaskId: string,
  agentName: string | undefined,
  processTaskId: unknown
) => {
  const currentTask = tasksById[currentTaskId];
  const taskRunning = currentTask?.taskRunning ?? [];
  const taskInfo = currentTask?.taskInfo ?? [];
  const taskAssigning = currentTask?.taskAssigning ?? [];

  const hasTaskId = (id: string) =>
    taskRunning.some((task) => task.id === id) ||
    taskInfo.some((task) => task.id === id) ||
    taskAssigning.some((agent) => agent.tasks.some((task) => task.id === id));

  const singleAgent = taskAssigning.find(
    (agent) => agent.type === 'single_agent'
  );
  const singleAgentTasks = singleAgent?.tasks ?? [];
  const singleAgentRunning =
    singleAgentTasks.find((task) => task.status === TaskStatus.RUNNING) ||
    taskRunning.find((task) => task.status === TaskStatus.RUNNING) ||
    singleAgentTasks.find((task) => task.status !== TaskStatus.COMPLETED) ||
    taskRunning.find((task) => task.status !== TaskStatus.COMPLETED);

  const direct = typeof processTaskId === 'string' ? processTaskId : '';
  if (direct && hasTaskId(direct)) return direct;
  if (singleAgentRunning?.id) return singleAgentRunning.id;

  // Prefer a task owned by the same agent
  const match = taskRunning.findLast(
    (t: any) =>
      typeof t?.id === 'string' &&
      t.id &&
      (agentName ? t.agent?.type === agentName : true)
  );
  if (match?.id) return match.id as string;
  // Fallback to the latest running task id
  const last = taskRunning.at(-1);
  if (typeof last?.id === 'string' && last.id) return last.id;
  if (direct) return direct;
  return '';
};

export const resolveToolkitEventAgentIndex = (
  taskAssigning: Agent[],
  identity: {
    agentId?: string;
    assigneeId?: string;
    agentName?: string;
  },
  processTaskId: string
): number => {
  const emittedAgentId = identity.agentId || identity.assigneeId;
  if (emittedAgentId) {
    const byId = taskAssigning.findIndex(
      (agent) => agent.agent_id === emittedAgentId
    );
    if (byId !== -1) return byId;
  }

  const emittedAgentName = identity.agentName?.split('.').at(-1);
  if (emittedAgentName) {
    const byName = taskAssigning.findIndex(
      (agent) =>
        agent.type === emittedAgentName || agent.name === emittedAgentName
    );
    if (byName !== -1) return byName;
  }

  return taskAssigning.findIndex((agent) =>
    agent.tasks.some((task) => task.id === processTaskId)
  );
};
// Throttle streaming decompose text updates to prevent excessive re-renders
const streamingDecomposeTextBuffer: Record<string, string> = {};
const streamingDecomposeTextTimers: Record<
  string,
  ReturnType<typeof setTimeout>
> = {};
// TTFT (Time to First Token) tracking for task decomposition
const ttftTracking: Record<
  string,
  { confirmedAt: number; firstTokenLogged: boolean }
> = {};

// Track which executionIds have already been reported to prevent duplicate updates
const reportedExecutionIds = new Set<string>();

// Helper function to update trigger execution status using executionId from task
const updateTriggerExecutionStatus = async (
  chatStoreState: ChatStore,
  projectId: string | null | undefined,
  currentTaskId: string,
  status: import('@/types').ExecutionStatus,
  tokens: number,
  errorMessage?: string
) => {
  console.log('[updateTriggerExecutionStatus] Called with:', {
    projectId,
    currentTaskId,
    status,
    tokens,
  });

  // Get executionId directly from the task
  const executionId = chatStoreState.tasks[currentTaskId]?.executionId;

  if (!executionId) {
    // No executionId means this is not a trigger-initiated task, skip silently
    console.log(
      '[updateTriggerExecutionStatus] No executionId found for task:',
      currentTaskId,
      '- skipping (not a trigger-initiated task)'
    );
    return;
  }

  // Check if this execution has already been reported
  if (reportedExecutionIds.has(executionId)) {
    console.log(
      '[updateTriggerExecutionStatus] Execution already reported:',
      executionId
    );
    return;
  }

  try {
    // Mark as reported to prevent duplicate updates
    reportedExecutionIds.add(executionId);

    // Call the API to update execution status
    await proxyUpdateTriggerExecution(
      executionId,
      {
        status,
        completed_at: new Date().toISOString(),
        ...(errorMessage && { error_message: errorMessage }),
        tokens_used: tokens,
      },
      { projectId: projectId || undefined }
    );

    console.log(
      '[updateTriggerExecutionStatus] Execution status updated:',
      executionId,
      '->',
      status
    );
  } catch (err) {
    console.warn(
      `[updateTriggerExecutionStatus] Failed to update execution status to ${status}:`,
      err
    );
    // Remove from reported set so it can be retried
    reportedExecutionIds.delete(executionId);
  }
};

const chatStore = (initial?: Partial<ChatStore>) =>
  createStore<ChatStore>()((set, get) => ({
    activeTaskId: null,
    nextTaskId: null,
    tasks: initial?.tasks ?? {},
    updateCount: 0,
    hydrateTask(taskId: string, state: Task) {
      set((s) => ({
        activeTaskId: taskId,
        tasks: {
          ...s.tasks,
          [taskId]: {
            ...state,
            // Never resurrect a task as pending / awaiting confirmation
            // from a cached snapshot — those are in-flight flags only.
            isPending: false,
            activeAsk: '',
            askList: [],
            resolvedInteractionIds: Array.isArray(state.resolvedInteractionIds)
              ? [...new Set(state.resolvedInteractionIds)]
              : [],
            autoConfirmDeadline: null,
            streamingDecomposeText: '',
            // File handles can't round-trip through JSON, so cached
            // attaches always come back empty.
            attaches: [],
          },
        },
      }));
    },
    create(id?: string, type?: any) {
      const taskId = id ? id : generateUniqueId();
      console.log('Create Task', taskId);
      set((state) => ({
        activeTaskId: taskId,
        tasks: {
          ...state.tasks,
          [taskId]: {
            type: type,
            source: 'user',
            messages: [],
            summaryTask: '',
            taskInfo: [],
            attaches: [],
            taskRunning: [],
            taskAssigning: [],
            fileList: [],
            webViewUrls: [],
            activeAsk: '',
            askList: [],
            resolvedInteractionIds: [],
            progressValue: 0,
            isPending: false,
            activeWorkspace: 'workflow',
            hasMessages: false,
            activeAgent: '',
            status: ChatTaskStatus.PENDING,
            taskTime: 0,
            tokens: 0,
            elapsed: 0,
            hasWaitComfirm: false,
            cotList: [],
            hasAddWorker: false,
            nuwFileNum: 0,
            delayTime: 0,
            selectedFile: null,
            snapshots: [],
            snapshotsTemp: [],
            isTakeControl: false,
            planDirty: false,
            autoConfirmDeadline: null,
            streamingDecomposeText: '',
            executionId: undefined,
            createdAt: Date.now(),
          },
        },
      }));
      return taskId;
    },
    computedProgressValue(taskId: string) {
      const { tasks, setProgressValue } = get();
      const taskRunning = [...tasks[taskId].taskRunning];
      const finishedTask = taskRunning?.filter(
        (task) =>
          task.status === TaskStatus.COMPLETED ||
          task.status === TaskStatus.FAILED
      ).length;
      const taskProgress =
        taskRunning.length > 0
          ? Number(((finishedTask / taskRunning.length) * 100).toFixed(2))
          : 0;
      setProgressValue(taskId, taskProgress);
    },
    removeTask(taskId: string) {
      // Clean up any pending auto-confirm timers when removing a task
      try {
        if (autoConfirmTimers[taskId]) {
          clearTimeout(autoConfirmTimers[taskId]);
          delete autoConfirmTimers[taskId];
        }
        get().setAutoConfirmDeadline(taskId, null);
      } catch (error) {
        console.warn('Error clearing auto-confirm timer in removeTask:', error);
      }

      // Clean up SSE connection if it exists
      try {
        if (activeSSEControllers[taskId]) {
          activeSSEControllers[taskId].controller.abort();
          delete activeSSEControllers[taskId];
        }
      } catch (error) {
        console.warn('Error aborting SSE connection in removeTask:', error);
      }

      set((state) => {
        delete state.tasks[taskId];
        return {
          tasks: {
            ...state.tasks,
          },
        };
      });
    },
    updateMessage(taskId: string, messageId: string, message: Message) {
      set((state) => {
        const task = state.tasks[taskId];
        if (!task) return state;
        const messages = task.messages.map((m) => {
          if (m.id === messageId) {
            return message;
          }
          return m;
        });
        return {
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...task,
              messages,
            },
          },
        };
      });
    },
    stopTask(taskId: string) {
      // Abort the SSE connection for this task
      try {
        if (activeSSEControllers[taskId]) {
          console.log(`Stopping SSE connection for task ${taskId}`);
          activeSSEControllers[taskId].controller.abort();
          delete activeSSEControllers[taskId];
        }
      } catch (error) {
        console.warn('Error aborting SSE connection in stopTask:', error);
        // Even if abort fails, still clean up the reference
        try {
          delete activeSSEControllers[taskId];
        } catch (cleanupError) {
          console.warn(
            'Error cleaning up SSE controller reference:',
            cleanupError
          );
        }
      }

      // Clean up any pending auto-confirm timers
      try {
        if (autoConfirmTimers[taskId]) {
          clearTimeout(autoConfirmTimers[taskId]);
          delete autoConfirmTimers[taskId];
        }
        get().setAutoConfirmDeadline(taskId, null);
      } catch (error) {
        console.warn('Error clearing auto-confirm timer in stopTask:', error);
      }

      // Update task status to finished - ensure this happens even if cleanup fails
      try {
        set((state) => {
          // Check if task exists before updating
          if (!state.tasks[taskId]) {
            console.warn(`Task ${taskId} not found when trying to stop it`);
            return state;
          }

          const task = state.tasks[taskId];
          const elapsed = settleTaskElapsedMs(task, Date.now());
          return {
            ...state,
            tasks: {
              ...state.tasks,
              [taskId]: {
                ...task,
                status: ChatTaskStatus.FINISHED,
                durableRunStatus: 'stopped',
                taskTime: 0,
                elapsed,
              },
            },
          };
        });
      } catch (error) {
        console.error(
          'Error updating task status to finished in stopTask:',
          error
        );
      }
    },
    startTask: async (
      taskId: string,
      type?: string,
      shareToken?: string,
      delayTime?: number,
      messageContent?: string,
      messageAttaches?: File[],
      executionId?: string,
      projectId?: string,
      sessionMode?: SessionModeType,
      options?: StartTaskOptions
    ) => {
      const { setDelayTime, setType } = get();
      if (type === 'replay') {
        setDelayTime(taskId, delayTime as number);
        setType(taskId, type);
        // A replay reconstructs persisted execution time from event
        // timestamps. Never carry a stale live clock across an idle/restart
        // interval or the END reducer will count that interval as work.
        get().setTaskTime(taskId, 0);
      }

      //ProjectStore must exist as chatStore is already
      const projectStore = useProjectStore.getState();
      const isLiveTask = !type || type === 'normal';
      const project_id = isLiveTask
        ? projectId
        : projectId || projectStore.activeProjectId;
      if (isLiveTask && !project_id) {
        throw new Error(
          i18next.t('chat.no-active-session', {
            defaultValue: 'No active session selected.',
          })
        );
      }
      const startOptions = options || {};
      const project =
        isLiveTask && project_id
          ? projectStore.getProjectById(project_id)
          : null;
      if (isLiveTask && !project) {
        throw new Error(
          i18next.t('chat.selected-session-unavailable', {
            defaultValue: 'The selected session is not available.',
          })
        );
      }
      const sessionModeForRequest =
        sessionMode || project?.mode || SessionMode.SINGLE_AGENT;
      // Track genuine, user-facing task starts (skip replay/share playback).
      // Powers the "time to first task" lifecycle event.
      if (isLiveTask) {
        const submitWorkers = getWorkerList();
        const submitHasMcp = submitWorkers.some(
          (w) => (w.workerInfo?.mcp_tools?.length ?? 0) > 0
        );
        recordTaskSubmitted({
          session_mode: sessionModeForRequest,
          task_source: executionId ? 'trigger' : 'user',
          agent_count: submitWorkers.length,
          has_mcp: submitHasMcp,
        });
        if (sessionModeForRequest === SessionMode.WORKFORCE) {
          recordFeatureUsed('multi_agent', {
            session_mode: sessionModeForRequest,
          });
        }
      }
      if (project_id && !project?.mode) {
        useSpaceStore
          .getState()
          .updateProjectMeta(project_id, { mode: sessionModeForRequest });
      }
      //Create a new chatStore on Start
      let newTaskId = taskId;
      let targetChatStore = { getState: () => get() }; // Default to current store
      /**
       * Replay creates its own chatStore for each task with replayProject
       */
      if (project_id && type !== 'replay' && startOptions.resumeRequestId) {
        const existing = projectStore
          .getAllChatStores(project_id)
          .find(({ chatStore }) => chatStore.getState().tasks[taskId]);
        if (existing) {
          newTaskId = taskId;
          targetChatStore = existing.chatStore;
          projectStore.setActiveChatStore(project_id, existing.chatId);
        } else {
          const active = projectStore.getChatStore(project_id);
          if (active) {
            targetChatStore = active;
            newTaskId = active.getState().create(taskId);
          } else {
            const created = projectStore.appendInitChatStore(
              project_id,
              taskId
            );
            if (created) {
              newTaskId = created.taskId;
              targetChatStore = created.chatStore;
            }
          }
        }
        const resumeState = targetChatStore.getState();
        resumeState.setActiveTaskId(newTaskId);
        resumeState.setStatus(newTaskId, ChatTaskStatus.PENDING);
        resumeState.setIsPending(newTaskId, true);
        resumeState.setHasWaitComfirm(newTaskId, false);
      } else if (project_id && type !== 'replay') {
        console.log('Creating a new Chat Instance for current project on end');
        const newChatResult = projectStore.appendInitChatStore(
          project_id,
          startOptions.preserveTaskId ? taskId : undefined
        );

        if (newChatResult) {
          newTaskId = newChatResult.taskId;
          targetChatStore = newChatResult.chatStore;
          targetChatStore.getState().setIsPending(newTaskId, true);

          // Set executionId if this is a trigger-initiated task
          if (executionId) {
            targetChatStore.getState().setExecutionId(newTaskId, executionId);
            targetChatStore.getState().setTaskSource(newTaskId, 'trigger');
          } else {
            targetChatStore.getState().setTaskSource(newTaskId, 'user');
          }

          //From handleSend if message is given
          // Add the message to the new chatStore if provided
          if (messageContent) {
            targetChatStore.getState().addMessages(newTaskId, {
              id: generateUniqueId(),
              role: 'user',
              content: messageContent,
              attaches: messageAttaches || [],
            });
            targetChatStore.getState().setHasMessages(newTaskId, true);
          }
        }
      }
      // For replay/share playback the real session mode is unknown until the
      // playback re-emits `todo_state` / `to_sub_tasks`. Pre-setting it here
      // would flash the wrong side panel when loading a saved session, so
      // only seed it for live tasks; playback resolves it from the events.
      if (!type || type === 'normal') {
        targetChatStore
          .getState()
          .setTaskSessionMode(newTaskId, sessionModeForRequest);
      }

      const finishStartupFailure = () => {
        if (!isLiveTask) return;
        const targetState = targetChatStore.getState();
        const task = targetState.tasks[newTaskId];
        if (!task) return;
        if (activeSSEControllers[newTaskId]) {
          try {
            activeSSEControllers[newTaskId].controller.abort();
          } catch {
            // Ignore abort errors while cleaning up a failed startup.
          }
          delete activeSSEControllers[newTaskId];
        }
        if (task.isPending) {
          targetState.setIsPending(newTaskId, false);
        }
        if (task.status !== ChatTaskStatus.FINISHED) {
          targetState.setStatus(newTaskId, ChatTaskStatus.FINISHED);
        }
      };

      // Render the new turn before waiting for Brain. This keeps the project
      // page responsive and locks the composer through the task's pending state.
      if (!type || type === 'normal') {
        console.log('[startTask] Checking if backend is ready...');
        const isBackendReady = await waitForBackendReady(60000, 500);

        if (!isBackendReady) {
          console.error('[startTask] Backend is not ready, cannot start task');
          // A task failure, not a launch failure — this can fire hours after
          // a successful launch and would otherwise skew launch-failure rate.
          recordTaskFailed({
            error_type: 'backend_unavailable',
            session_mode: sessionModeForRequest,
          });
          const targetState = targetChatStore.getState();
          targetState.addMessages(newTaskId, {
            id: generateUniqueId(),
            role: 'agent',
            content: i18next.t('chat.backend-not-ready', {
              defaultValue:
                '❌ Backend service is not ready. Wait a moment and try again, or restart the application if the problem continues.',
            }),
          });
          targetState.setIsPending(newTaskId, false);
          targetState.setStatus(newTaskId, ChatTaskStatus.FINISHED);
          return;
        }
        console.log('[startTask] Backend is ready, proceeding with task...');
      }

      const {
        token,
        language,
        modelType,
        cloud_model_type,
        codex_model_type,
        email,
        user_id,
      } = getAuthStore();
      const workerList = getWorkerList();
      const { getLastUserMessage: _getLastUserMessage } = get();
      let systemLanguage = language;
      if (language === 'system') {
        try {
          systemLanguage =
            (await getHostIpcRenderer()?.invoke?.('get-system-language')) ??
            'en';
        } catch {
          systemLanguage = 'en';
        }
      }

      // Replay/share APIs live on the server side, not Brain.
      const serverBaseUrl = import.meta.env.DEV
        ? window.location.origin
        : import.meta.env.VITE_BASE_URL;
      const canonicalReplayCursor = createCanonicalRunEventCursor();
      let shadowProjectionCursor = createLegacyChatProjectionCursor(newTaskId);
      const api =
        type == 'share'
          ? `${serverBaseUrl}/api/v1/chat/share/playback/${shareToken}?delay_time=${delayTime}`
          : type == 'replay'
            ? startOptions.replaySource === 'local_durable'
              ? `/runs/${encodeURIComponent(newTaskId)}/stream?after_sequence=${canonicalReplayCursor.lastSequence}`
              : `${serverBaseUrl}/api/v1/chat/steps/playback/${newTaskId}?delay_time=${delayTime}`
            : '/chat';

      const { tasks: _tasks } = get();
      let historyId: string | null =
        startOptions.historyId != null
          ? String(startOptions.historyId)
          : project_id
            ? projectStore.getHistoryId(project_id)
            : null;
      let snapshots: any = [];
      let skipFirstConfirm = true;
      let playbackFirstStepTimeMs: number | null = null;
      let playbackLastStepTimeMs: number | null = null;
      let localDurableLegacyEventCount = 0;

      // replay or share request
      if (type && startOptions.replaySource !== 'local_durable') {
        const res = await proxyFetchGet(`/api/v1/chat/snapshots`, {
          api_task_id: taskId,
        });
        if (res) {
          snapshots = [
            ...new Map(
              res.map((item: any) => [item.camel_task_id, item])
            ).values(),
          ];
        }
      }

      // Reuse the model captured on this Project (if any) so follow-up runs
      // keep the conversation's model even when the global default changed.
      const pinnedModelSelection =
        !type && project_id ? projectStore.getProjectModel(project_id) : null;
      const effectiveModelType = pinnedModelSelection?.modelType ?? modelType;
      let resolvedProviderId: number | undefined;
      let resolvedCloudModelId: string | undefined;
      let resolvedCodexModelId: string | undefined;

      // get current model
      let apiModel = {
        api_key: '',
        model_type: '',
        model_platform: '',
        api_url: '',
        model_config_dict: {},
        extra_params: {},
        auth_source: undefined as 'codex_subscription' | undefined,
      };
      if (
        !type &&
        (effectiveModelType === 'custom' || effectiveModelType === 'local')
      ) {
        let provider: any = null;
        if (pinnedModelSelection?.provider_id !== undefined) {
          try {
            const res = await proxyFetchGet('/api/v1/providers');
            const providerList = Array.isArray(res) ? res : res.items || [];
            provider =
              providerList.find(
                (p: { id: number }) => p.id === pinnedModelSelection.provider_id
              ) || null;
          } catch (error) {
            console.error('Failed to load pinned model provider:', error);
          }
          if (!provider) {
            toast.warning(
              i18next.t('chat.model-fallback-warning', {
                defaultValue:
                  'The model used earlier in this conversation is no longer available. Falling back to the default model.',
              })
            );
          }
        }
        if (!provider) {
          const res = await proxyFetchGet('/api/v1/providers', {
            prefer: true,
          });
          const providerList = res.items || [];
          provider = providerList[0];
        }

        if (!provider) {
          finishStartupFailure();
          throw new Error(
            i18next.t('chat.no-model-provider', {
              defaultValue:
                'No model provider is configured. Go to Agents > Models and configure at least one default model provider.',
            })
          );
        }

        const { modelConfigDict, extraParams } = splitProviderConfig(
          provider.encrypted_config
        );
        apiModel = {
          api_key: provider.api_key,
          model_type: provider.model_type,
          model_platform: provider.provider_name,
          api_url: provider.endpoint_url || provider.api_url,
          model_config_dict: modelConfigDict,
          extra_params: extraParams,
          auth_source: undefined,
        };
        resolvedProviderId = provider.id;
      } else if (!type && effectiveModelType === 'cloud') {
        const requestedCloudModelId =
          pinnedModelSelection?.cloud_model_type || cloud_model_type;
        const cloudModelStore = getCloudModelStore();
        let resolvedCloudModel = cloudModelStore.resolveCloudModel(
          requestedCloudModelId
        );
        if (!resolvedCloudModel || resolvedCloudModel.source !== 'selected') {
          await cloudModelStore.fetchCloudModels(true);
          resolvedCloudModel = getCloudModelStore().resolveCloudModel(
            requestedCloudModelId
          );
        }
        if (!resolvedCloudModel) {
          finishStartupFailure();
          throw new Error(
            i18next.t('chat.cloud-model-unavailable', {
              defaultValue:
                'The cloud model is unavailable. Try again or choose another model in Agents > Models.',
            })
          );
        }
        if (
          resolvedCloudModel.source === 'default' &&
          resolvedCloudModel.requestedModelId
        ) {
          const message = i18next.t('chat.cloud-model-switched', {
            defaultValue:
              'Model {{requestedModel}} is no longer available; switched to {{fallbackModel}}.',
            requestedModel: resolvedCloudModel.requestedModelId,
            fallbackModel: resolvedCloudModel.model.display_name,
          });
          console.warn(message);
          toast.warning(message);
        }
        if (
          !pinnedModelSelection &&
          resolvedCloudModel.model.id !== cloud_model_type
        ) {
          getAuthStore().setCloudModelType(resolvedCloudModel.model.id);
        }

        let res: any;
        try {
          res = await proxyFetchGet('/api/v1/user/key');
        } catch (error: any) {
          finishStartupFailure();
          const responseData = error?.response?.data;
          if (
            hasApiCode(responseData, API_CODE_TRIAL_LIMIT) ||
            hasApiCode(error, API_CODE_TRIAL_LIMIT)
          ) {
            throw new Error(
              responseData?.text ||
                error?.message ||
                i18next.t('chat.free-trial-limit-reached', {
                  defaultValue:
                    'Free trial usage limit reached. Switch to a local or custom model, or use another API key to continue.',
                })
            );
          }
          throw error;
        }
        if (hasApiCode(res, API_CODE_TRIAL_LIMIT)) {
          finishStartupFailure();
          throw new Error(
            res.text ||
              i18next.t('chat.free-trial-limit-reached', {
                defaultValue:
                  'Free trial usage limit reached. Switch to a local or custom model, or use another API key to continue.',
              })
          );
        }
        if (!res.value) {
          finishStartupFailure();
          throw new Error(
            res.text ||
              i18next.t('chat.cloud-model-key-failed', {
                defaultValue:
                  'Could not get the cloud model key. Check your account or model settings.',
              })
          );
        }
        if (res.warning_code && res.warning_code === '21') {
          showStorageToast();
        }
        apiModel = {
          api_key: res.value,
          model_type: resolvedCloudModel.model.model_type,
          model_platform: resolvedCloudModel.model.model_platform,
          api_url: res.api_url,
          model_config_dict: {},
          extra_params: cloudModelRequestExtraParams(resolvedCloudModel.model),
          auth_source: undefined,
        };
        resolvedCloudModelId = resolvedCloudModel.model.id;
      } else if (!type && effectiveModelType === 'codex_subscription') {
        const codexModelId =
          pinnedModelSelection?.codex_model_type ||
          codex_model_type ||
          'gpt-5.5';
        apiModel = {
          api_key: '',
          model_type: codexModelId,
          model_platform: 'openai',
          api_url: '',
          model_config_dict: {},
          extra_params: {},
          auth_source: 'codex_subscription',
        };
        resolvedCodexModelId = codexModelId;
      }

      // Capture the resolved model on the Project so later runs (including
      // conversations reloaded from history) keep using it.
      if (!type && project_id && apiModel.model_platform) {
        projectStore.setProjectModel(project_id, {
          modelType: effectiveModelType,
          ...(resolvedCloudModelId
            ? { cloud_model_type: resolvedCloudModelId }
            : {}),
          ...(resolvedCodexModelId
            ? { codex_model_type: resolvedCodexModelId }
            : {}),
          ...(resolvedProviderId !== undefined
            ? { provider_id: resolvedProviderId }
            : {}),
          model_platform: apiModel.model_platform,
          model_type: apiModel.model_type,
        });
      }

      // Resolve the user-selected search path for this Run. Querit may use
      // anonymous access or a user key; custom models retain Google BYOK as a
      // fallback when both Google values are present.
      let searchConfig: Record<string, string> = {};
      if (!type) {
        try {
          const configsRes = await proxyFetchGet('/api/v1/configs');
          const configs = Array.isArray(configsRes)
            ? configsRes.filter(
                (config: any) => config.config_group?.toLowerCase() === 'search'
              )
            : [];
          searchConfig = buildSearchRuntimeConfig(configs, {
            includeGoogle: effectiveModelType === 'custom',
          });
        } catch (error) {
          console.error('Failed to load search configuration:', error);
        }
      }

      let remoteSubAgentConfig = null;
      if (!type) {
        try {
          const providersRes = await proxyFetchGet(
            '/api/v1/remote-sub-agent-providers',
            { provider_name: REMOTE_SUB_AGENT_PROVIDER_ID, enabled: true }
          );
          const providerList = Array.isArray(providersRes)
            ? providersRes
            : providersRes.items || [];
          const remoteSubAgentProvider = providerList[0];
          remoteSubAgentConfig = toRemoteSubAgentRuntimeConfig(
            normalizeRemoteSubAgentProvider(remoteSubAgentProvider)
          );
        } catch (error) {
          console.error(
            'Failed to load remote sub agent configuration:',
            error
          );
        }
      }

      const workerProviderIds = !type
        ? workerList
            .map((worker) => worker.workerInfo?.model_provider_id)
            .filter((providerId): providerId is number =>
              Number.isInteger(providerId)
            )
        : [];
      const workerProvidersById = new Map<number, any>();
      if (workerProviderIds.length > 0) {
        let workerProviderList: any[];
        try {
          const providersRes = await proxyFetchGet('/api/v1/providers');
          workerProviderList = Array.isArray(providersRes)
            ? providersRes
            : providersRes.items || [];
        } catch (error) {
          finishStartupFailure();
          throw new Error(
            i18next.t('chat.worker-model-provider-load-failed', {
              defaultValue:
                'Could not load the model provider configured for a worker.',
            }),
            { cause: error }
          );
        }

        workerProviderList.forEach((provider) => {
          workerProvidersById.set(Number(provider.id), provider);
        });

        const missingWorker = workerList.find((worker) => {
          const providerId = worker.workerInfo?.model_provider_id;
          return (
            Number.isInteger(providerId) &&
            !workerProvidersById.has(providerId as number)
          );
        });
        if (missingWorker) {
          finishStartupFailure();
          throw new Error(
            i18next.t('chat.worker-model-provider-unavailable', {
              defaultValue:
                'The model provider configured for worker "{{worker}}" is no longer available. Edit the worker and select another model.',
              worker: missingWorker.name,
            })
          );
        }
      }

      const connectorGatewayMcpConfig = !type
        ? await buildConnectorGatewayMcpConfig(token)
        : null;

      const addWorkers = workerList.map((worker) => {
        const providerId = worker.workerInfo?.model_provider_id;
        const provider = Number.isInteger(providerId)
          ? workerProvidersById.get(providerId as number)
          : undefined;
        return {
          name: worker.workerInfo?.name,
          description: worker.workerInfo?.description,
          tools: worker.workerInfo?.tools,
          mcp_tools: mergeMcpConfigs(
            worker.workerInfo?.mcp_tools,
            connectorGatewayMcpConfig
          ),
          custom_model_config: provider
            ? buildAgentModelConfigFromProvider(provider)
            : undefined,
        };
      });

      // get env path (Electron only)
      let envPath = '';
      if (!type) {
        try {
          envPath =
            (await getHostIpcRenderer()?.invoke?.('get-env-path', email)) ?? '';
        } catch (error) {
          console.log('get-env-path error', error);
        }
      }

      // create history
      const spaceId = resolveSpaceIdForProject(project_id);
      if (spaceId && project_id && project?.spaceId !== spaceId) {
        projectStore.setProjectSpace(project_id, spaceId);
      }
      const requestSpace = spaceId
        ? useSpaceStore.getState().getSpaceById(spaceId)
        : null;
      const spaceRootPath = isLocalWorkspaceSpace(requestSpace)
        ? requestSpace?.rootPath || undefined
        : undefined;
      if (!type && !startOptions.skipHistoryCreate) {
        const authStore = getAuthStore();

        const obj = {
          space_id: spaceId,
          project_id: project_id,
          task_id: newTaskId,
          run_id: newTaskId,
          user_id: authStore.user_id,
          // Persist Project execution mode on the server so reload reflects
          // the user's last choice (workforce vs single-agent). Without this
          // Project.mode stays NULL and the picker defaults back to single.
          mode: sessionModeForRequest,
          workdir_mode: project?.workdirMode || undefined,
          question:
            messageContent ||
            (targetChatStore.getState().tasks[newTaskId]?.messages[0]
              ?.content ??
              ''),
          language: systemLanguage,
          model_platform: apiModel.model_platform,
          model_type: apiModel.model_type,
          api_url: effectiveModelType === 'cloud' ? 'cloud' : apiModel.api_url,
          max_retries: 3,
          file_save_path: 'string',
          installed_mcp: 'string',
          status: 1,
          tokens: 0,
        };
        await proxyFetchPost(`/api/v1/chat/history`, obj).then((res) => {
          historyId = res.id;

          /**Save history id for replay reuse purposes.
           * TODO(history): Remove historyId handling to support per projectId
           * instead in history api
           */
          if (project_id && historyId)
            projectStore.setHistoryId(project_id, historyId);
        });
      } else if (!type && project_id && historyId) {
        projectStore.setHistoryId(project_id, historyId);
      }
      let browser_port: number | undefined;
      let cdp_browsers: any[] = [];
      if (!type) {
        try {
          ({ browser_port, cdp_browsers } = await resolveCdpBrowsersForRequest(
            shouldEnsureBrowserForRequest(
              workerList,
              sessionModeForRequest,
              messageContent
            )
          ));
        } catch {
          // Web mode: no CDP
        }
      }

      // Use the Run control API as the authoritative Resume admission gate.
      // It returns real 404/409 errors for terminal, cancelled, cloud-restored,
      // or unsafe-to-replay Runs. Only after all local model/workspace preflight
      // has succeeded do we create the durable pending Attempt.
      if (startOptions.resumeRequestId) {
        try {
          await admitDurableRunResume(newTaskId, startOptions.resumeRequestId);
        } catch (error) {
          finishStartupFailure();
          throw error;
        }
      }

      // Lock the chatStore reference at the start of SSE session to prevent focus changes
      // during active message processing
      let lockedChatStore: VanillaChatStore =
        targetChatStore as VanillaChatStore;
      let lockedTaskId = newTaskId;

      // Create AbortController for this task's SSE connection
      // First check if there's already an active SSE connection for this task
      if (activeSSEControllers[newTaskId] && type === 'replay') {
        // A history replay must never tear down a live run's stream: the
        // ongoing run is the fresher state, and aborting it kills the run
        // on the backend. Leave the live connection alone.
        console.warn(
          `Task ${newTaskId} already has an active SSE connection, skipping history replay`
        );
        return;
      }
      if (activeSSEControllers[newTaskId]) {
        console.warn(
          `Task ${newTaskId} already has an active SSE connection, aborting old one`
        );
        try {
          activeSSEControllers[newTaskId].controller.abort();
        } catch (error) {
          console.warn('Error aborting existing SSE connection:', error);
        }
        delete activeSSEControllers[newTaskId];
      }

      const abortController = new AbortController();
      activeSSEControllers[newTaskId] = {
        controller: abortController,
        live: isLiveTask,
      };

      // Getter functions that use the locked references instead of dynamic ones
      const getCurrentChatStore = () => {
        return lockedChatStore.getState();
      };

      // Get the locked task ID - this won't change during the SSE session
      const getCurrentTaskId = () => {
        return lockedTaskId;
      };

      // Function to update locked references (only for special cases like replay)
      const updateLockedReferences = (
        newChatStore: VanillaChatStore,
        newTaskId: string
      ) => {
        lockedChatStore = newChatStore;
        lockedTaskId = newTaskId;
      };

      /**
       * Follow-up Runs share the original `/chat` SSE transport. Move the
       * reducer lock at the same exact event where the shadow projection
       * changes Run, otherwise a direct WAIT_CONFIRM answer is reduced into
       * the completed preceding task.
       */
      const activatePreparedFollowUpRun = (
        runId: string,
        prompt: string | null,
        createIfMissing: boolean
      ): boolean => {
        if (lockedTaskId === runId) return true;

        const sourceChatStore = lockedChatStore;
        const sourceState = sourceChatStore.getState();
        const sourceTaskId = lockedTaskId;
        let targetChatStore: VanillaChatStore | null = sourceState.tasks[runId]
          ? sourceChatStore
          : null;

        if (!targetChatStore && project_id) {
          const activeProjectChatStore =
            projectStore.getChatStore?.(project_id);
          if (activeProjectChatStore?.getState().tasks[runId]) {
            targetChatStore = activeProjectChatStore;
          }
        }

        if (!targetChatStore && createIfMissing && project_id) {
          targetChatStore =
            projectStore.appendInitChatStore(project_id, runId)?.chatStore ??
            null;
        }
        if (!targetChatStore?.getState().tasks[runId]) return false;

        const targetState = targetChatStore.getState();
        const targetTask = targetState.tasks[runId];
        const hasPrompt = targetTask.messages.some(
          (message) => message.role === 'user'
        );
        if (!hasPrompt && prompt) {
          const sourceMessage = sourceState.tasks[
            sourceTaskId
          ]?.messages.findLast(
            (message) => message.role === 'user' && message.content === prompt
          );
          if (sourceMessage?.id) {
            sourceState.removeMessage(sourceTaskId, sourceMessage.id);
            targetChatStore.getState().addMessages(runId, sourceMessage);
          } else {
            targetChatStore.getState().addMessages(runId, {
              id: generateUniqueId(),
              role: 'user',
              content: prompt,
            });
          }
        }

        const preparedState = targetChatStore.getState();
        preparedState.setActiveTaskId(runId);
        preparedState.setIsPending(runId, true);
        preparedState.setHasMessages(runId, true);
        updateLockedReferences(targetChatStore, runId);
        return true;
      };

      const requestBody = !type
        ? {
            space_id: spaceId,
            project_id: project_id,
            task_id: newTaskId,
            run_id: newTaskId,
            space_root_path: spaceRootPath,
            workdir_mode: project?.workdirMode || undefined,
            question: startOptions.resumeRequestId
              ? targetChatStore.getState().getLastUserMessage()?.content ||
                i18next.t('chat.resume-interrupted-task', {
                  defaultValue: 'Resume interrupted task',
                })
              : messageContent ||
                targetChatStore.getState().getLastUserMessage()?.content,
            model_platform: apiModel.model_platform,
            email,
            user_id: getAuthStore().user_id,
            model_type: apiModel.model_type,
            api_key: apiModel.api_key,
            api_url: apiModel.api_url,
            model_config_dict: apiModel.model_config_dict,
            extra_params: apiModel.extra_params,
            thinking_effort: projectStore.getProjectThinkingEffortOverride(
              project_id ?? null
            ),
            auth_source: apiModel.auth_source,
            installed_mcp: connectorGatewayMcpConfig || { mcpServers: {} },
            language: systemLanguage,
            allow_local_system: true,
            attaches: (
              messageAttaches ||
              targetChatStore.getState().tasks[newTaskId]?.attaches ||
              []
            ).map((f) => f.filePath),
            summary_prompt: ``,
            new_agents: [...addWorkers],
            browser_port: browser_port,
            cdp_browsers: cdp_browsers,
            env_path: envPath,
            search_config: searchConfig,
            server_url: getDirectServerApiBaseUrl(),
            session_mode: sessionModeForRequest,
            remote_sub_agent_config: remoteSubAgentConfig,
            project_context: buildProjectContinuationContext(
              project_id,
              startOptions.resumeRequestId ? undefined : newTaskId
            ),
            resume_request_id: startOptions.resumeRequestId,
            review_handoff_ids: startOptions.reviewHandoffIds ?? [],
          }
        : undefined;

      let resumeStreamOpened = false;
      let resolveResumeStreamOpen: (() => void) | undefined;
      let rejectResumeStreamOpen: ((error: unknown) => void) | undefined;
      const resumeStreamOpenPromise =
        startOptions.resumeRequestId || startOptions.awaitAdmission
          ? new Promise<void>((resolve, reject) => {
              resolveResumeStreamOpen = resolve;
              rejectResumeStreamOpen = reject;
            })
          : null;
      let replayCaughtUp = false;
      let resolveReplayCaughtUp: (() => void) | undefined;
      const replayCaughtUpPromise =
        type === 'replay' &&
        startOptions.replaySource === 'local_durable' &&
        startOptions.detachReplayAfterCatchUp
          ? new Promise<void>((resolve) => {
              resolveReplayCaughtUp = resolve;
            })
          : null;

      const ssePromise = sseTransport({
        url: api,
        method: !type ? 'POST' : 'GET',
        openWhenHidden: true,
        signal: abortController.signal,
        body: requestBody,
        extraHeaders:
          type == 'replay' && token
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        async onmessage(event: any) {
          if (replayCaughtUpPromise && event?.event === 'replay_caught_up') {
            replayCaughtUp = true;
            resolveReplayCaughtUp?.();
            return;
          }
          let agentMessages: AgentMessage;

          try {
            const parsed = JSON.parse(event.data);
            if (startOptions.replaySource === 'local_durable') {
              shadowProjectionCursor = advanceLegacyChatProjectionCursor(
                shadowProjectionCursor,
                shadowProjectionCursor.runId,
                shadowProjectionCursor.sourceId
              );
              if (
                !acceptCanonicalRunEvent(
                  canonicalReplayCursor,
                  parsed,
                  event.id
                )
              ) {
                return;
              }
              const canonicalProjectId =
                typeof parsed?.project_id === 'string'
                  ? parsed.project_id
                  : project_id;
              if (canonicalProjectId) {
                runEventIngressRegistry.ingest(
                  canonicalProjectId,
                  newTaskId,
                  parsed,
                  'historical_rehydrate'
                );
              }
              enqueueChatEventProjection({
                raw: parsed,
                projectId: project_id,
                runId: shadowProjectionCursor.runId,
                sequence: shadowProjectionCursor.sequence,
                sourceId: shadowProjectionCursor.sourceId,
                transport: 'local_run',
              });
              // /runs/{id}/stream returns the canonical RunEvent envelope.
              // The existing Desktop reducer remains legacy-shaped during
              // migration, so typed-only/control events advance the stream
              // cursor but do not enter the UI projector.
              const projected = canonicalRunEventToLegacyMessage(parsed);
              if (!projected) {
                return;
              }
              localDurableLegacyEventCount += 1;
              agentMessages = stampAgentMessageTimeline(
                projected,
                resolveCanonicalTimelineSequence(
                  parsed,
                  shadowProjectionCursor.sequence
                )
              );
            } else {
              // A follow-up Run reuses this SSE connection. Scope CONFIRMED
              // itself (and every later frame) to the prepared next task; if
              // we wait for the legacy reducer to switch ChatStores, the
              // first event of the new Run is permanently attributed to the
              // preceding Run. Rotate the synthetic source as well as its
              // sequence so `(run, source, sequence)` stays unambiguous.
              const projectionRunId = resolveLegacyChatProjectionRunId({
                step: parsed?.step,
                currentRunId: shadowProjectionCursor.runId,
                nextRunId: getCurrentChatStore().nextTaskId,
                eventTaskId: parsed?.data?.task_id,
              });
              if (projectionRunId !== shadowProjectionCursor.runId) {
                activatePreparedFollowUpRun(
                  projectionRunId,
                  nonEmptyString(
                    parsed?.data?.content ?? parsed?.data?.question
                  ) ?? null,
                  parsed?.step === AgentStep.NEW_TASK_STATE
                );
              }
              shadowProjectionCursor = advanceLegacyChatProjectionCursor(
                shadowProjectionCursor,
                projectionRunId
              );
              enqueueChatEventProjection({
                raw: parsed,
                projectId: project_id,
                runId: shadowProjectionCursor.runId,
                sequence: shadowProjectionCursor.sequence,
                sourceId: shadowProjectionCursor.sourceId,
                transport: 'legacy_chat',
              });
              agentMessages = stampAgentMessageTimeline(
                parsed,
                shadowProjectionCursor.sequence
              );
            }
          } catch (error) {
            console.error('Failed to parse SSE message:', error);
            console.error('Raw event.data:', event.data);

            // Create error task to notify user
            const currentStore = getCurrentChatStore();
            const newTaskId = currentStore.create();
            currentStore.setActiveTaskId(newTaskId);
            currentStore.setHasWaitComfirm(newTaskId, true);
            currentStore.addMessages(newTaskId, {
              id: generateUniqueId(),
              role: 'agent',
              content: i18next.t('chat.server-message-parse-error', {
                defaultValue:
                  '**System error**: Failed to parse the server message. The connection may be unstable.\n\nTry again or contact support if this continues.',
              }),
            });
            return;
          }

          if (type) {
            const stepTimeMs = getPersistedStepTimeMs(agentMessages);
            if (stepTimeMs !== null) {
              playbackFirstStepTimeMs ??= stepTimeMs;
              playbackLastStepTimeMs = stepTimeMs;
            }
          }

          if (
            agentMessages &&
            typeof agentMessages === 'object' &&
            'error' in agentMessages &&
            !('step' in agentMessages)
          ) {
            const currentStore = getCurrentChatStore();
            const currentTaskId = getCurrentTaskId();
            const errorText =
              typeof (agentMessages as any).error === 'string'
                ? (agentMessages as any).error
                : i18next.t('chat.replay-data-unavailable', {
                    defaultValue: 'Replay data is unavailable for this task.',
                  });

            currentStore.addMessages(currentTaskId, {
              id: generateUniqueId(),
              role: 'agent',
              content: errorText,
            });
            currentStore.setIsPending(currentTaskId, false);
            currentStore.setStatus(currentTaskId, ChatTaskStatus.FINISHED);
            return;
          }

          // Check if this task has been stopped before processing any message
          // But allow messages that switch to new tasks (like confirmed events)
          const lockedTaskId = getCurrentTaskId();
          const currentTask = getCurrentChatStore().tasks[lockedTaskId];

          // Only ignore messages if task is finished and not a valid post-completion event
          // Valid events after task completion:
          // - Task switching: confirmed, new_task_state, end
          // - Multi-turn simple answer: wait_confirm
          const isTaskSwitchingEvent =
            agentMessages.step === AgentStep.CONFIRMED ||
            agentMessages.step === AgentStep.NEW_TASK_STATE ||
            agentMessages.step === AgentStep.END;

          const isMultiTurnSimpleAnswer =
            agentMessages.step === AgentStep.WAIT_CONFIRM;

          const isPostCompletionProjectionEvent =
            agentMessages.step === AgentStep.ARTIFACT_MANIFEST ||
            agentMessages.step === AgentStep.ARTIFACT_UPLOADED ||
            agentMessages.step === AgentStep.PROJECT_METADATA;

          if (!currentTask) {
            console.log(
              `Task ${lockedTaskId} not found, ignoring SSE message for step: ${agentMessages.step}`
            );
            return;
          }

          if (
            currentTask.status === ChatTaskStatus.FINISHED &&
            !isTaskSwitchingEvent &&
            !isMultiTurnSimpleAnswer &&
            !isPostCompletionProjectionEvent
          ) {
            // Ignore messages for finished tasks except:
            // 1. Task switching events (create new chatStore)
            // 2. Simple answer events (direct response without new chatStore)
            console.log(
              `Ignoring SSE message for finished task ${lockedTaskId}, step: ${agentMessages.step}`
            );
            return;
          }

          console.log('agentMessages', agentMessages);
          const agentNameMap = {
            developer_agent: i18next.t('chat.developer-agent', {
              defaultValue: 'Developer agent',
            }),
            browser_agent: i18next.t('chat.browser-agent', {
              defaultValue: 'Browser agent',
            }),
            document_agent: i18next.t('chat.document-agent', {
              defaultValue: 'Document agent',
            }),
            multi_modal_agent: i18next.t('chat.multimodal-agent', {
              defaultValue: 'Multimodal agent',
            }),
            social_media_agent: i18next.t('chat.social-media-agent', {
              defaultValue: 'Social media agent',
            }),
            single_agent: i18next.t('chat.camel-agent', {
              defaultValue: 'CAMEL agent',
            }),
          };

          /**
           * Persistent workforce instance, new chat
           * If confirmed -> subtasks -> confirmed (use a new chatStore)
           * handle cases for @event new_task_state and @function startTask
           */
          let currentTaskId = getCurrentTaskId();
          const previousChatStore = getCurrentChatStore();
          if (agentMessages.step === AgentStep.CONFIRMED) {
            const { question } = agentMessages.data;
            const shouldCreateNewChat = shouldAppendTaskForConfirmedEvent({
              projectId: project_id,
              question,
              messageContent,
              skipFirstConfirm,
              replaySource: startOptions.replaySource,
            });

            //All except first confirmed event to reuse the existing chatStore
            if (shouldCreateNewChat) {
              /**
               * For Tasks where appended to existing project by
               * reusing same projectId. Need to create new chatStore
               * as it has been skipped earlier in startTask.
               */
              const nextTaskId = previousChatStore.nextTaskId || undefined;
              const isPreparedFollowUp = Boolean(
                nextTaskId &&
                currentTaskId === nextTaskId &&
                previousChatStore.tasks[currentTaskId]
              );
              const newChatResult: {
                taskId: string;
                chatStore: VanillaChatStore;
              } | null = isPreparedFollowUp
                ? { taskId: currentTaskId, chatStore: lockedChatStore }
                : projectStore.appendInitChatStore(
                    project_id || projectStore.activeProjectId!,
                    nextTaskId
                  );

              if (newChatResult) {
                const { taskId: newTaskId, chatStore: newChatStore } =
                  newChatResult;

                // Update references for both scenarios
                updateLockedReferences(newChatStore, newTaskId);
                newChatStore.getState().setIsPending(newTaskId, false);

                // If nextExecutionId exists, pass it to new task
                if (previousChatStore.tasks[currentTaskId]?.nextExecutionId) {
                  newChatStore
                    .getState()
                    .setExecutionId(
                      newTaskId,
                      previousChatStore.tasks[currentTaskId]?.nextExecutionId
                    );
                }

                if (type === 'replay') {
                  newChatStore
                    .getState()
                    .setDelayTime(newTaskId, delayTime as number);
                  newChatStore.getState().setType(newTaskId, 'replay');
                }

                const isFollowUpConfirm = Boolean(previousChatStore.nextTaskId);
                const lastMessage =
                  previousChatStore.tasks[currentTaskId]?.messages.at(-1);
                if (
                  !isPreparedFollowUp &&
                  lastMessage?.role === 'user' &&
                  lastMessage?.id
                ) {
                  previousChatStore.removeMessage(
                    currentTaskId,
                    lastMessage.id
                  );
                }

                const attachesForNewMessage =
                  lastMessage?.role === 'user' && lastMessage?.attaches?.length
                    ? lastMessage.attaches
                    : [
                        ...(previousChatStore.tasks[currentTaskId]?.attaches ||
                          []),
                        ...(messageAttaches || []),
                      ];

                // Three candidate sources for the user prompt body.
                //   1. lastMessage.content -- the prompt ChatBox.handleSend
                //      just added to the previous chatStore. This is what
                //      the user actually typed *this turn* and is therefore
                //      authoritative for both startTask and improve flows.
                //   2. question -- the SSE CONFIRMED event's question field.
                //      This is the current improve/follow-up prompt.
                //   3. messageContent -- the closure-captured arg passed to
                //      the original startTask call. It is accurate for the
                //      first run but stale for improve turns because the SSE
                //      consumer remains alive across the whole Project.
                //
                // So the fallback order depends on the lifecycle:
                // - first startTask confirmed: messageContent before question
                // - follow-up confirmed: question before stale messageContent
                const userMessageContent = resolveConfirmedUserMessageContent({
                  lastMessageContent:
                    lastMessage?.role === 'user'
                      ? lastMessage.content
                      : undefined,
                  messageContent,
                  question,
                  isFollowUpConfirm,
                });
                if (!isPreparedFollowUp) {
                  newChatStore.getState().addMessages(newTaskId, {
                    id: generateUniqueId(),
                    role: 'user',
                    content: userMessageContent,
                    attaches: attachesForNewMessage,
                  });
                }
                console.log('[NEW CHATSTORE] Created for ', project_id);

                //Create a new history point
                if (!type) {
                  const authStore = getAuthStore();

                  const obj = {
                    space_id: spaceId,
                    project_id: project_id,
                    task_id: newTaskId,
                    run_id: newTaskId,
                    user_id: authStore.user_id,
                    mode: sessionModeForRequest,
                    // Mirror the user-message-content priority above: prefer
                    // what we just wrote into the new task (the prompt the
                    // user actually typed), and only fall back to SSE
                    // `question` / closure `messageContent` if the new task
                    // somehow has no user message yet.
                    question:
                      (newChatStore.getState().tasks[newTaskId]?.messages[0]
                        ?.content as string) ||
                      userMessageContent ||
                      '',
                    language: systemLanguage,
                    model_platform: apiModel.model_platform,
                    model_type: apiModel.model_type,
                    api_url:
                      effectiveModelType === 'cloud'
                        ? 'cloud'
                        : apiModel.api_url,
                    max_retries: 3,
                    file_save_path: 'string',
                    installed_mcp: 'string',
                    status: 1,
                    tokens: 0,
                  };
                  await proxyFetchPost(`/api/v1/chat/history`, obj).then(
                    (res) => {
                      historyId = res.id;

                      /**Save history id for replay reuse purposes.
                       * TODO(history): Remove historyId handling to support per projectId
                       * instead in history api
                       */
                      if (project_id && historyId)
                        projectStore.setHistoryId(project_id, historyId);
                    }
                  );

                  const currentTaskId = getCurrentTaskId();
                  // Update trigger execution status to Completed for connection closed by server
                  updateTriggerExecutionStatus(
                    getCurrentChatStore(),
                    project_id,
                    currentTaskId,
                    ExecutionStatus.Running,
                    getCurrentChatStore().tasks[currentTaskId]?.tokens || 0
                  );
                }
              }
            } else {
              //NOTE: Triggered only with first "confirmed" in the project
              //Handle Original cases - with old chatStore
              previousChatStore.setStatus(
                currentTaskId,
                ChatTaskStatus.PENDING
              );
              previousChatStore.setHasWaitComfirm(currentTaskId, false);
            }

            //Enable it for the rest of current SSE session
            skipFirstConfirm = false;

            // Record confirmed time for TTFT tracking
            const ttftTaskId = getCurrentTaskId();
            ttftTracking[ttftTaskId] = {
              confirmedAt: performance.now(),
              firstTokenLogged: false,
            };
            console.log(
              `[TTFT] Task ${ttftTaskId} confirmed at ${new Date().toISOString()}, starting TTFT measurement`
            );
            const confirmedStore = getCurrentChatStore();
            const confirmedTask = confirmedStore.tasks[ttftTaskId];
            if (
              !type &&
              sessionModeForRequest === SessionMode.SINGLE_AGENT &&
              confirmedTask?.taskTime === 0
            ) {
              // Single Agent has no manual plan-confirm boundary. Admission
              // is the start of its durable Attempt, so seed the clock here
              // instead of waiting for the first todo_state/model response.
              // This also gives pre-TODO transport errors a non-zero duration.
              confirmedStore.setTaskTime(ttftTaskId, Date.now());
            }
            return;
          }

          const {
            setNuwFileNum,
            setCotList,
            getTokens,
            setUpdateCount,
            addTokens,
            setStatus,
            addWebViewUrl,
            setIsPending,
            addMessages,
            updateMessage,
            setHasWaitComfirm,
            setSummaryTask,
            setTaskAssigning,
            setTaskInfo,
            setTaskRunning,
            setTaskSessionMode,
            addTerminal,
            addFileList,
            setActiveAsk,
            setActiveAskList,
            tasks,
            create: _create,
            setTaskTime,
            setElapsed,
            setActiveTaskId: _setActiveTaskId,
            setIsContextExceeded,
            setStreamingDecomposeText,
            clearStreamingDecomposeText,
            setPlanDirty,
            setAutoConfirmDeadline,
          } = getCurrentChatStore();

          currentTaskId = getCurrentTaskId();
          // if (tasks[currentTaskId].status === ChatTaskStatus.FINISHED) return
          if (agentMessages.step === AgentStep.DECOMPOSE_TEXT) {
            const { content } = agentMessages.data;
            const text = content;
            const currentId = getCurrentTaskId();

            // Log TTFT (Time to First Token) on first decompose_text event
            if (
              ttftTracking[currentId] &&
              !ttftTracking[currentId].firstTokenLogged
            ) {
              ttftTracking[currentId].firstTokenLogged = true;
              const ttft =
                performance.now() - ttftTracking[currentId].confirmedAt;
              console.log(
                `[TTFT] Time to First Token: ${ttft.toFixed(2)}ms - first streaming token for task ${currentId}`
              );
            }

            // Get current buffer or task state
            const currentContent =
              streamingDecomposeTextBuffer[currentId] ||
              getCurrentChatStore().tasks[currentId]?.streamingDecomposeText ||
              '';
            const newContent = text || '';
            let updatedContent = newContent;

            if (newContent.startsWith(currentContent)) {
              // Accumulated format: new content contains old content -> Replace
              updatedContent = newContent;
            } else {
              // Delta format: new content is a chunk -> Append
              updatedContent = currentContent + newContent;
            }

            // Store in buffer immediately
            streamingDecomposeTextBuffer[currentId] = updatedContent;

            // Throttle store updates to every 50ms for smoother streaming display
            if (!streamingDecomposeTextTimers[currentId]) {
              streamingDecomposeTextTimers[currentId] = setTimeout(() => {
                const bufferedText = streamingDecomposeTextBuffer[currentId];
                if (bufferedText !== undefined) {
                  setStreamingDecomposeText(currentId, bufferedText);
                }
                delete streamingDecomposeTextTimers[currentId];
              }, 16);
            }
            return;
          }

          if (agentMessages.step === AgentStep.PROJECT_METADATA) {
            const summaryTask = String(
              agentMessages.data.summary_task || ''
            ).trim();
            const [summaryName = '', ...summaryParts] = summaryTask.split('|');
            const projectName = String(
              agentMessages.data.project_name || summaryName
            ).trim();
            const projectSummary = String(
              agentMessages.data.project_summary || summaryParts.join('|')
            ).trim();
            const metadataTaskId = agentMessages.data.task_id || currentTaskId;

            if (summaryTask && tasks[metadataTaskId]) {
              setSummaryTask(metadataTaskId, summaryTask);
            }
            syncProjectDisplayName(project_id, projectName);

            if (!type && historyId && projectName) {
              void proxyFetchPut(`/api/v1/chat/history/${historyId}`, {
                project_name: projectName,
                summary: clampHistorySummary(projectSummary),
                tokens: getTokens(metadataTaskId),
              });
            }
            return;
          }

          if (agentMessages.step === AgentStep.TO_SUB_TASKS) {
            setTaskSessionMode(currentTaskId, SessionMode.WORKFORCE);
            // Clear streaming decompose text when task splitting is done
            clearStreamingDecomposeText(currentTaskId);
            // Clean up TTFT tracking
            delete ttftTracking[currentTaskId];

            // Check if task is already confirmed - don't overwrite user edits
            const existingToSubTasksMessage = tasks[
              currentTaskId
            ].messages.findLast(
              (m: Message) => m.step === AgentStep.TO_SUB_TASKS
            );
            if (existingToSubTasksMessage?.isConfirm) {
              return;
            }

            // Check if this is a multi-turn scenario after task completion
            const isMultiTurnAfterCompletion =
              tasks[currentTaskId].status === ChatTaskStatus.FINISHED;

            // Reset status for multi-turn complex tasks to allow splitting panel to show
            if (isMultiTurnAfterCompletion) {
              setStatus(currentTaskId, ChatTaskStatus.PENDING);
            }

            // Each splitting round starts in a clean editing state
            setPlanDirty(currentTaskId, false);

            const messages = [...tasks[currentTaskId].messages];
            const toSubTaskIndex = messages.findLastIndex(
              (message: Message) => message.step === AgentStep.TO_SUB_TASKS
            );
            // For multi-turn scenarios, always create a new to_sub_tasks message
            // even if one already exists from a previous task
            if (toSubTaskIndex === -1 || isMultiTurnAfterCompletion) {
              // Clear any pending auto-confirm timer from previous rounds
              try {
                if (autoConfirmTimers[currentTaskId]) {
                  clearTimeout(autoConfirmTimers[currentTaskId]);
                  delete autoConfirmTimers[currentTaskId];
                }
                setAutoConfirmDeadline(currentTaskId, null);
              } catch (error) {
                console.warn('Error clearing auto-confirm timer:', error);
              }

              // 30 seconds auto confirm
              try {
                setAutoConfirmDeadline(
                  currentTaskId,
                  Date.now() + AUTO_CONFIRM_TIMEOUT_MS
                );
                const scheduledTaskId = currentTaskId;
                const scheduledProjectId = project_id;
                const scheduledType = type;
                autoConfirmTimers[scheduledTaskId] = setTimeout(async () => {
                  try {
                    const currentStore = getCurrentChatStore();
                    const {
                      tasks,
                      handleConfirmTask,
                      setPlanDirty,
                      setAutoConfirmDeadline,
                    } = currentStore;
                    const latestTask = tasks[scheduledTaskId];
                    if (!latestTask) {
                      delete autoConfirmTimers[scheduledTaskId];
                      return;
                    }
                    const message = latestTask.messages.findLast(
                      (item) => item.step === AgentStep.TO_SUB_TASKS
                    );
                    const isConfirm = message?.isConfirm || false;
                    const isTakeControl = latestTask.isTakeControl;

                    if (
                      scheduledProjectId &&
                      !isConfirm &&
                      !isTakeControl &&
                      !latestTask.planDirty
                    ) {
                      await handleConfirmTask(
                        scheduledProjectId,
                        scheduledTaskId,
                        scheduledType
                      );
                    }
                    setPlanDirty(scheduledTaskId, false);
                    setAutoConfirmDeadline(scheduledTaskId, null);
                    delete autoConfirmTimers[scheduledTaskId];
                  } catch (error) {
                    console.error(
                      'Error in auto-confirm timeout handler:',
                      error
                    );
                    // Clean up the timer reference even if there's an error
                    setAutoConfirmDeadline(scheduledTaskId, null);
                    delete autoConfirmTimers[scheduledTaskId];
                  }
                }, AUTO_CONFIRM_TIMEOUT_MS);
              } catch (error) {
                console.error('Error setting auto-confirm timer:', error);
                setAutoConfirmDeadline(currentTaskId, null);
              }

              const newNoticeMessage: Message = {
                id: generateUniqueId(),
                role: 'agent',
                content: '',
                step: AgentStep.NOTICE_CARD,
              };
              addMessages(currentTaskId, newNoticeMessage);
              const shouldAutoConfirm = !!type && !isMultiTurnAfterCompletion;

              const newMessage: Message = {
                id: generateUniqueId(),
                role: 'agent',
                content: '',
                step: agentMessages.step,
                taskType: type ? 2 : 1,
                showType: 'list',
                // Don't auto-confirm for multi-turn complex tasks - show workforce splitting panel
                isConfirm: shouldAutoConfirm,
                task_id: currentTaskId,
              };
              addMessages(currentTaskId, newMessage);
              const newTaskInfo = {
                id: '',
                content: '',
              };
              type !== 'replay' &&
                agentMessages.data.sub_tasks?.push(newTaskInfo);
            }
            // Sub-tasks arrive from the backend with a camel `state` field
            // (OPEN/RUNNING/DONE/FAILED), not the frontend's `status`. Seed
            // every entry with EMPTY so the badge renders as Pending; later
            // SSE events (ASSIGN_TASK, TASK_STATE, …) drive the real status.
            // Replay finalization happens in the END handler below.
            agentMessages.data.sub_tasks = agentMessages.data.sub_tasks?.map(
              (item) => {
                item.status = TaskStatus.EMPTY;
                return item;
              }
            );

            if (!type && historyId) {
              const projectName =
                agentMessages.data!.summary_task?.split('|')[0] || '';
              const obj = {
                project_name: projectName,
                summary: clampHistorySummary(
                  agentMessages.data!.summary_task?.split('|')[1]
                ),
                tokens: getTokens(currentTaskId),
              };
              syncProjectDisplayName(project_id, projectName);
              proxyFetchPut(`/api/v1/chat/history/${historyId}`, obj);
            }
            setSummaryTask(
              currentTaskId,
              agentMessages.data.summary_task as string
            );
            setTaskInfo(
              currentTaskId,
              agentMessages.data.sub_tasks as TaskInfo[]
            );
            setTaskRunning(
              currentTaskId,
              agentMessages.data.sub_tasks as TaskInfo[]
            );
            return;
          }
          // Create agent
          if (agentMessages.step === AgentStep.CREATE_AGENT) {
            const { agent_name, agent_id } = agentMessages.data;
            if (!agent_name || !agent_id) return;

            // Add agent to taskAssigning
            if (
              ![
                'mcp_agent',
                'new_worker_agent',
                'task_agent',
                'task_summary_agent',
                'coordinator_agent',
                'question_confirm_agent',
              ].includes(agent_name)
            ) {
              // if (agentNameMap[agent_name as keyof typeof agentNameMap]) {
              const hasAgent = tasks[currentTaskId].taskAssigning.find(
                (agent) => agent.agent_id === agent_id
              );

              if (!hasAgent) {
                let activeWebviewIds: any = [];
                if (agent_name == 'browser_agent') {
                  snapshots.forEach((item: any) => {
                    const snapshotUrl = item.image_url || item.image_path || '';
                    if (!snapshotUrl) return;
                    const imgurl = !snapshotUrl.includes('/public')
                      ? snapshotUrl
                      : (import.meta.env.DEV
                          ? import.meta.env.VITE_PROXY_URL
                          : import.meta.env.VITE_BASE_URL) + snapshotUrl;
                    activeWebviewIds.push({
                      id: item.id,
                      img: imgurl,
                      processTaskId: item.camel_task_id,
                      url: item.browser_url,
                    });
                  });
                }
                setTaskAssigning(currentTaskId, [
                  ...tasks[currentTaskId].taskAssigning,
                  {
                    agent_id,
                    name:
                      agentNameMap[agent_name as keyof typeof agentNameMap] ||
                      agent_name,
                    type: agent_name as AgentNameType,
                    tasks: [],
                    log: [],
                    img: [],
                    tools: agentMessages.data.tools,
                    activeWebviewIds: activeWebviewIds,
                  },
                ]);
              }
            }
            return;
          }
          if (agentMessages.step === AgentStep.WAIT_CONFIRM) {
            const { content, question } = agentMessages.data;
            setHasWaitComfirm(currentTaskId, true);
            setIsPending(currentTaskId, false);

            const currentChatStore = getCurrentChatStore();
            //Make sure to add user Message on replay and avoid duplication of first msg
            if (
              question &&
              !(currentChatStore.tasks[currentTaskId].messages.length === 1)
            ) {
              //Replace the optimistic update if existent.
              const lastMessage =
                currentChatStore.tasks[currentTaskId]?.messages.at(-1);
              if (
                lastMessage?.role === 'user' &&
                lastMessage.id &&
                lastMessage.content === question
              ) {
                currentChatStore.removeMessage(currentTaskId, lastMessage.id);
              }
              addMessages(currentTaskId, {
                id: generateUniqueId(),
                role: 'user',
                content: question as string,
                step: AgentStep.WAIT_CONFIRM,
                isConfirm: false,
              });
            }
            addMessages(currentTaskId, {
              id: generateUniqueId(),
              role: 'agent',
              content: content as string,
              step: AgentStep.WAIT_CONFIRM,
              isConfirm: false,
            });

            // Update trigger execution status to Completed for simple question/answer flow
            // This handles cases where the task ends with wait_confirm instead of the end step
            updateTriggerExecutionStatus(
              currentChatStore,
              project_id,
              currentTaskId,
              ExecutionStatus.Completed,
              currentChatStore.tasks[currentTaskId]?.tokens || 0
            );

            return;
          }
          if (agentMessages.step === AgentStep.TODO_STATE) {
            setTaskSessionMode(currentTaskId, SessionMode.SINGLE_AGENT);
            const todos = agentMessages.data.todos || [];
            const agentId =
              agentMessages.data.agent_id || `${currentTaskId}-single-agent`;
            const existingAgents = [...tasks[currentTaskId].taskAssigning];
            const existingIndex = existingAgents.findIndex(
              (agent) =>
                agent.agent_id === agentId || agent.type === 'single_agent'
            );
            const previousTasks = [
              ...(existingIndex === -1
                ? []
                : existingAgents[existingIndex].tasks || []),
              ...(tasks[currentTaskId].taskRunning || []),
              ...(tasks[currentTaskId].taskInfo || []),
            ];
            const previousTaskById = new Map(
              previousTasks.map((task) => [task.id, task])
            );
            const todoTasks: TaskInfo[] = todos.map((todo, index) => {
              const id = todo.id || `todo_${index + 1}`;
              const previous = previousTaskById.get(id);
              return {
                ...previous,
                id,
                content:
                  todo.status === 'in_progress' && todo.active_form
                    ? todo.active_form
                    : todo.content,
                status:
                  todo.status === 'completed'
                    ? TaskStatus.COMPLETED
                    : todo.status === 'in_progress'
                      ? TaskStatus.RUNNING
                      : TaskStatus.EMPTY,
                toolkits: previous?.toolkits,
                terminal: previous?.terminal,
                fileList: previous?.fileList,
                report: previous?.report,
                failure_count: previous?.failure_count,
              };
            });
            const singleAgent: Agent =
              existingIndex === -1
                ? {
                    agent_id: agentId,
                    name: 'CAMEL Agent',
                    type: 'single_agent',
                    tasks: todoTasks,
                    log: [],
                    img: [],
                    tools: ['TodoToolkit'],
                    activeWebviewIds: [],
                  }
                : {
                    ...existingAgents[existingIndex],
                    agent_id: existingAgents[existingIndex].agent_id || agentId,
                    name: existingAgents[existingIndex].name || 'CAMEL Agent',
                    type: 'single_agent',
                    tasks: todoTasks,
                  };

            if (existingIndex === -1) {
              existingAgents.push(singleAgent);
            } else {
              existingAgents[existingIndex] = singleAgent;
            }

            setTaskInfo(currentTaskId, todoTasks);
            setTaskRunning(currentTaskId, todoTasks);
            setTaskAssigning(currentTaskId, existingAgents);
            if (tasks[currentTaskId].status !== ChatTaskStatus.FINISHED) {
              // Single-agent tasks have no confirm step, so `taskTime` is never
              // seeded by `handleConfirmTask`. Start the work-log clock here on
              // the first `todo_state`; the `=== 0` guard keeps it idempotent.
              if (tasks[currentTaskId].taskTime === 0) {
                setTaskTime(currentTaskId, Date.now());
              }
              setStatus(currentTaskId, ChatTaskStatus.RUNNING);
            }
            return;
          }
          // Task State
          if (agentMessages.step === AgentStep.TASK_STATE) {
            const { state, task_id, result, failure_count } =
              agentMessages.data;
            if (!state && !task_id) return;

            let taskRunning = [...tasks[currentTaskId].taskRunning];
            let taskAssigning = [...tasks[currentTaskId].taskAssigning];
            const targetTaskIndex = taskRunning.findIndex(
              (task) => task.id === task_id
            );
            const targetTaskAssigningIndex = taskAssigning.findIndex((agent) =>
              agent.tasks.find(
                (task: TaskInfo) => task.id === task_id && !task.reAssignTo
              )
            );
            if (targetTaskAssigningIndex !== -1) {
              const taskIndex = taskAssigning[
                targetTaskAssigningIndex
              ].tasks.findIndex((task: TaskInfo) => task.id === task_id);
              taskAssigning[targetTaskAssigningIndex].tasks[taskIndex].status =
                state === 'DONE' ? TaskStatus.COMPLETED : TaskStatus.FAILED;
              taskAssigning[targetTaskAssigningIndex].tasks[
                taskIndex
              ].failure_count = failure_count || 0;

              // destroy webview
              tasks[currentTaskId].taskAssigning = tasks[
                currentTaskId
              ].taskAssigning.map((item) => {
                if (
                  item.type === 'browser_agent' &&
                  item.activeWebviewIds?.length &&
                  item.activeWebviewIds?.length > 0
                ) {
                  let removeList: number[] = [];
                  item.activeWebviewIds.map((webview, index) => {
                    if (webview.processTaskId === task_id) {
                      getHostElectronAPI()?.webviewDestroy?.(webview.id);
                      removeList.push(index);
                    }
                  });
                  removeList.forEach((webviewIndex) => {
                    item.activeWebviewIds?.splice(webviewIndex, 1);
                  });
                }
                return item;
              });

              if (result && result !== '') {
                let targetResult = result.replace(
                  taskAssigning[targetTaskAssigningIndex].agent_id,
                  taskAssigning[targetTaskAssigningIndex].name
                );
                taskAssigning[targetTaskAssigningIndex].tasks[
                  taskIndex
                ].report = targetResult;
                if (state === 'FAILED' && failure_count && failure_count >= 3) {
                  addMessages(currentTaskId, {
                    id: generateUniqueId(),
                    role: 'agent',
                    content: targetResult,
                    step: AgentStep.FAILED,
                  });
                }
              }
            }
            if (targetTaskIndex !== -1) {
              console.log('targetTaskIndex', targetTaskIndex, state);
              taskRunning[targetTaskIndex].status =
                state === 'DONE' ? TaskStatus.COMPLETED : TaskStatus.FAILED;
            }
            setTaskRunning(currentTaskId, taskRunning);
            setTaskAssigning(currentTaskId, taskAssigning);
            return;
          }
          /**  New Task State from queue
           * @deprecated
           * Side effect handled on top of the message handler
           */
          if (agentMessages.step === AgentStep.NEW_TASK_STATE) {
            const {
              task_id,
              content,
              state: _state,
              result: _result,
              failure_count: _failure_count,
            } = agentMessages.data;
            //new chatStore logic is handled along side "confirmed" event
            console.log(
              `Received new task: ${task_id} with content: ${content}`
            );
            return;
          }

          // Request-level token usage updates (non-stream mode)
          if (agentMessages.step === AgentStep.REQUEST_USAGE) {
            if (agentMessages.data.tokens) {
              addTokens(currentTaskId, agentMessages.data.tokens);
              const stepKey = `${currentTaskId}:${agentMessages.data.agent_id}`;
              requestUsageStepTokens.set(
                stepKey,
                agentMessages.data.step_total_tokens ||
                  (requestUsageStepTokens.get(stepKey) || 0) +
                    agentMessages.data.tokens
              );
            }
            return;
          }

          // Activate agent
          if (
            agentMessages.step === AgentStep.ACTIVATE_AGENT ||
            agentMessages.step === AgentStep.DEACTIVATE_AGENT
          ) {
            let taskAssigning = [...tasks[currentTaskId].taskAssigning];
            let taskRunning = [...tasks[currentTaskId].taskRunning];
            if (agentMessages.data.tokens) {
              addTokens(currentTaskId, agentMessages.data.tokens);
            }
            // Consume the step's request_usage tokens before any early
            // return below, so entries are cleaned up even for agents that
            // never appear in taskAssigning.
            let stepTokens = 0;
            if (agentMessages.step === AgentStep.DEACTIVATE_AGENT) {
              const stepKey = `${currentTaskId}:${agentMessages.data.agent_id}`;
              stepTokens =
                agentMessages.data.tokens ||
                requestUsageStepTokens.get(stepKey) ||
                0;
              requestUsageStepTokens.delete(stepKey);
            }
            const { state, agent_id, process_task_id } = agentMessages.data;
            if (!state && !agent_id && !process_task_id) return;
            const agentIndex = taskAssigning.findIndex(
              (agent) => agent.agent_id === agent_id
            );

            if (agentIndex === -1) return;

            // // add log
            // const message = filterMessage(agentMessages.data.message || '', agentMessages.data.method_name)
            // if (message) {
            // 	taskAssigning[agentIndex].log.push(agentMessages);
            // }

            const message = filterMessage(agentMessages);
            if (agentMessages.step === AgentStep.ACTIVATE_AGENT) {
              taskAssigning[agentIndex].status = AgentStatusValue.RUNNING;
              if (message) {
                taskAssigning[agentIndex].log.push({
                  ...agentMessages,
                  status: AgentMessageStatus.RUNNING,
                });
              }
              const taskIndex = taskRunning.findIndex(
                (task) => task.id === process_task_id
              );
              if (taskIndex !== -1 && taskRunning![taskIndex].status) {
                taskRunning![taskIndex].agent!.status =
                  AgentStatusValue.RUNNING;
                taskRunning![taskIndex]!.status = TaskStatus.RUNNING;

                const task = taskAssigning[agentIndex].tasks.find(
                  (task: TaskInfo) => task.id === process_task_id
                );
                if (task) {
                  task.status = TaskStatus.RUNNING;
                }
              }
              setTaskRunning(currentTaskId, [...taskRunning]);
              setTaskAssigning(currentTaskId, [...taskAssigning]);
            }
            if (agentMessages.step === AgentStep.DEACTIVATE_AGENT) {
              if (message) {
                const index = taskAssigning[agentIndex].log.findLastIndex(
                  (log) =>
                    log.data.method_name === agentMessages.data.method_name &&
                    log.data.toolkit_name === agentMessages.data.toolkit_name
                );
                if (index != -1) {
                  taskAssigning[agentIndex].log[index].status =
                    AgentMessageStatus.COMPLETED;
                  setTaskAssigning(currentTaskId, [...taskAssigning]);
                }
              }
              const taskIndex = taskRunning.findIndex(
                (task) => task.id === process_task_id
              );
              if (taskIndex !== -1 && taskRunning[taskIndex].agent) {
                taskRunning[taskIndex].agent!.status = 'completed';
              }

              if (!type && historyId) {
                const projectName =
                  tasks[currentTaskId].summaryTask.split('|')[0];
                const obj = {
                  project_name: projectName,
                  summary: clampHistorySummary(
                    tasks[currentTaskId].summaryTask.split('|')[1]
                  ),
                  tokens: getTokens(currentTaskId),
                };
                syncProjectDisplayName(project_id, projectName);
                proxyFetchPut(`/api/v1/chat/history/${historyId}`, obj);
              }

              // Check if this is a quick reply completion (simple question answered directly)
              // This happens when question_confirm_agent deactivates with a non-yes/no answer
              // and tokens are used (indicating actual response generation, not just classification)
              const isQuestionConfirmAgent =
                agentMessages.data.agent_name === 'question_confirm_agent';
              // Per-step tokens (not the task total) so an errored/empty
              // step is not mistaken for a real reply.
              const hasTokens = stepTokens > 0;
              const isNotClassificationAnswer =
                agentMessages.data.message &&
                agentMessages.data.message.trim().toLowerCase() !== 'yes' &&
                agentMessages.data.message.trim().toLowerCase() !== 'no';

              if (
                isQuestionConfirmAgent &&
                hasTokens &&
                isNotClassificationAnswer
              ) {
                // This is a quick reply - update trigger execution status to Completed
                updateTriggerExecutionStatus(
                  getCurrentChatStore(),
                  project_id,
                  currentTaskId,
                  ExecutionStatus.Completed,
                  tasks[currentTaskId]?.tokens || 0
                );
              }

              setTaskRunning(currentTaskId, [...taskRunning]);
              setTaskAssigning(currentTaskId, [...taskAssigning]);
            }
            return;
          }
          // Assign task
          if (agentMessages.step === AgentStep.ASSIGN_TASK) {
            if (
              !agentMessages.data?.assignee_id ||
              !agentMessages.data?.task_id
            )
              return;

            const {
              assignee_id,
              task_id,
              content = '',
              state: taskState,
              failure_count,
            } = agentMessages.data as any;
            let taskAssigning = [...tasks[currentTaskId].taskAssigning];
            let taskRunning = [...tasks[currentTaskId].taskRunning];
            let taskInfo = [...tasks[currentTaskId].taskInfo];

            // Find the index of the agent corresponding to assignee_id
            const assigneeAgentIndex = taskAssigning!.findIndex(
              (agent: Agent) => agent.agent_id === assignee_id
            );
            // Find task corresponding to task_id
            const task = taskInfo!.find(
              (task: TaskInfo) => task.id === task_id
            );

            const taskRunningIndex = taskRunning!.findIndex(
              (task: TaskInfo) => task.id === task_id
            );

            // Skip tasks with empty content only if the task doesn't exist in taskInfo
            // If task exists in taskInfo, we should still process status updates
            if ((!content || content.trim() === '') && !task) {
              console.warn(
                `Skipping task ${task_id} with empty content and not found in taskInfo`
              );
              return;
            }

            if (assigneeAgentIndex === -1) return;
            const taskAgent = taskAssigning![assigneeAgentIndex];

            // Find the agent to reassign the task to
            const target = taskAssigning
              .map((agent, agentIndex) => {
                if (agent.agent_id === assignee_id) return null;

                const taskIndex = agent.tasks.findIndex(
                  (task: TaskInfo) => task.id === task_id && !task.reAssignTo
                );

                return taskIndex !== -1 ? { agentIndex, taskIndex } : null;
              })
              .find(Boolean);

            if (target) {
              const { agentIndex, taskIndex } = target;
              const agentName = taskAssigning.find(
                (agent: Agent) => agent.agent_id === assignee_id
              )?.name;
              if (agentName !== taskAssigning[agentIndex].name) {
                taskAssigning[agentIndex].tasks[taskIndex].reAssignTo =
                  agentName;
              }
            }

            // Clear logs from the assignee agent that are related to this task
            // This prevents logs from previous attempts appearing in the reassigned task
            // This needs to happen whether it's a reassignment to a different agent or a retry with the same agent
            if (
              taskState !== TaskStatus.WAITING &&
              failure_count &&
              failure_count > 0
            ) {
              taskAssigning[assigneeAgentIndex].log = taskAssigning[
                assigneeAgentIndex
              ].log.filter((log) => log.data.process_task_id !== task_id);
            }

            // Handle task assignment to taskAssigning based on state
            if (taskState === TaskStatus.WAITING) {
              if (
                !taskAssigning[assigneeAgentIndex].tasks.find(
                  (item) => item.id === task_id
                )
              ) {
                taskAssigning[assigneeAgentIndex].tasks.push(
                  task ?? { id: task_id, content, status: TaskStatus.WAITING }
                );
              }
              setTaskAssigning(currentTaskId, [...taskAssigning]);
            }
            // The following logic is for when the task actually starts executing (running)
            else if (taskAssigning && taskAssigning[assigneeAgentIndex]) {
              // Check if task already exists in the agent's task list
              const existingTaskIndex = taskAssigning[
                assigneeAgentIndex
              ].tasks.findIndex((item) => item.id === task_id);

              if (existingTaskIndex !== -1) {
                // Task already exists, update its status
                taskAssigning[assigneeAgentIndex].tasks[
                  existingTaskIndex
                ].status = TaskStatus.RUNNING;
                if (failure_count !== 0) {
                  taskAssigning[assigneeAgentIndex].tasks[
                    existingTaskIndex
                  ].failure_count = failure_count;
                }
              } else {
                // Task doesn't exist, add it
                let taskTemp = null;
                if (task) {
                  taskTemp = JSON.parse(JSON.stringify(task));
                  taskTemp.failure_count = 0;
                  taskTemp.status = TaskStatus.RUNNING;
                  taskTemp.toolkits = [];
                  taskTemp.report = '';
                }
                taskAssigning[assigneeAgentIndex].tasks.push(
                  taskTemp ?? {
                    id: task_id,
                    content,
                    status: TaskStatus.RUNNING,
                  }
                );
              }
            }

            // Only update or add to taskRunning, never duplicate
            if (taskRunningIndex === -1) {
              // Task not in taskRunning, add it
              if (task) {
                task.status =
                  taskState === TaskStatus.WAITING
                    ? TaskStatus.WAITING
                    : TaskStatus.RUNNING;
              }
              taskRunning!.push(
                task ?? {
                  id: task_id,
                  content,
                  status:
                    taskState === TaskStatus.WAITING
                      ? TaskStatus.WAITING
                      : TaskStatus.RUNNING,
                  agent: JSON.parse(JSON.stringify(taskAgent)),
                }
              );
            } else {
              // Task already in taskRunning, update it
              taskRunning![taskRunningIndex] = {
                ...taskRunning![taskRunningIndex],
                status:
                  taskState === TaskStatus.WAITING
                    ? TaskStatus.WAITING
                    : TaskStatus.RUNNING,
                agent: JSON.parse(JSON.stringify(taskAgent)),
              };
            }
            setTaskRunning(currentTaskId, [...taskRunning]);
            setTaskAssigning(currentTaskId, [...taskAssigning]);

            return;
          }
          // Activate Toolkit
          if (agentMessages.step === AgentStep.ACTIVATE_TOOLKIT) {
            // add log
            let taskAssigning = [...tasks[currentTaskId].taskAssigning];
            const resolvedProcessTaskId = resolveProcessTaskIdForToolkitEvent(
              tasks,
              currentTaskId,
              agentMessages.data.agent_name,
              agentMessages.data.process_task_id
            );
            let assigneeAgentIndex = resolveToolkitEventAgentIndex(
              taskAssigning,
              {
                agentId: agentMessages.data.agent_id,
                assigneeId: agentMessages.data.assignee_id,
                agentName: agentMessages.data.agent_name,
              },
              resolvedProcessTaskId
            );

            // Fallback: if task ID not found, try finding by agent type
            if (assigneeAgentIndex === -1 && agentMessages.data.agent_name) {
              assigneeAgentIndex = taskAssigning!.findIndex(
                (agent: Agent) => agent.type === agentMessages.data.agent_name
              );
            }
            if (
              assigneeAgentIndex === -1 &&
              (isSingleAgentEventName(agentMessages.data.agent_name) ||
                tasks[currentTaskId].sessionMode === SessionMode.SINGLE_AGENT)
            ) {
              assigneeAgentIndex = ensureSingleAgentAssignment(
                taskAssigning,
                currentTaskId,
                agentMessages.data.agent_id
              );
            }

            if (assigneeAgentIndex !== -1) {
              const message = filterMessage(agentMessages);
              if (message) {
                taskAssigning[assigneeAgentIndex].log.push(agentMessages);
                setTaskAssigning(currentTaskId, [...taskAssigning]);
              }
            }

            if (
              agentMessages.data.toolkit_name === 'Browser Toolkit' &&
              agentMessages.data.method_name === 'browser visit page'
            ) {
              addWebViewUrl(
                currentTaskId,
                normalizeToolkitMessage(agentMessages.data.message)
                  .replace(/url=/g, '')
                  .replace(/'/g, '') as string,
                resolvedProcessTaskId
              );
            }
            if (
              agentMessages.data.toolkit_name === 'Browser Toolkit' &&
              agentMessages.data.method_name === 'visit page'
            ) {
              console.log('match success');
              addWebViewUrl(
                currentTaskId,
                normalizeToolkitMessage(agentMessages.data.message) as string,
                resolvedProcessTaskId
              );
            }
            if (
              agentMessages.data.toolkit_name === 'ElectronToolkit' &&
              agentMessages.data.method_name === 'browse_url'
            ) {
              addWebViewUrl(
                currentTaskId,
                normalizeToolkitMessage(agentMessages.data.message) as string,
                resolvedProcessTaskId
              );
            }
            if (
              agentMessages.data.method_name === 'browser_navigate' &&
              agentMessages.data.message?.startsWith('{"url"')
            ) {
              try {
                const urlData = JSON.parse(
                  normalizeToolkitMessage(agentMessages.data.message)
                );
                if (urlData?.url) {
                  addWebViewUrl(
                    currentTaskId,
                    urlData.url as string,
                    resolvedProcessTaskId
                  );
                }
              } catch (error) {
                console.error('Failed to parse browser_navigate URL:', error);
                console.error('Raw message:', agentMessages.data.message);
              }
            }
            let taskRunning = [...tasks[currentTaskId].taskRunning];

            const taskIndex = taskRunning.findIndex(
              (task) => task.id === resolvedProcessTaskId
            );

            if (taskIndex !== -1) {
              const { toolkit_name, method_name } = agentMessages.data;
              if (toolkit_name && method_name) {
                const message = filterMessage(agentMessages);
                if (message) {
                  const toolkit = {
                    toolkitId: generateUniqueId(),
                    toolkitName: toolkit_name,
                    toolkitMethods: method_name,
                    message: normalizeToolkitMessage(message.data.message),
                    toolkitStatus: AgentStatusValue.RUNNING,
                  };

                  // Update taskAssigning if we found the agent
                  if (assigneeAgentIndex !== -1) {
                    const task = taskAssigning[assigneeAgentIndex].tasks.find(
                      (task: TaskInfo) => task.id === resolvedProcessTaskId
                    );
                    if (task) {
                      task.toolkits ??= [];
                      task.toolkits.push({ ...toolkit });
                      task.status = TaskStatus.RUNNING;
                      setTaskAssigning(currentTaskId, [...taskAssigning]);
                    }
                  }

                  // Always update taskRunning (even if assigneeAgentIndex is -1)
                  taskRunning![taskIndex].status = TaskStatus.RUNNING;
                  taskRunning![taskIndex].toolkits ??= [];
                  taskRunning![taskIndex].toolkits.push({ ...toolkit });
                }
              }
            }
            setTaskRunning(currentTaskId, taskRunning);
            return;
          }
          // Deactivate Toolkit
          if (agentMessages.step === AgentStep.DEACTIVATE_TOOLKIT) {
            // add log
            let taskAssigning = [...tasks[currentTaskId].taskAssigning];
            const resolvedProcessTaskId = resolveProcessTaskIdForToolkitEvent(
              tasks,
              currentTaskId,
              agentMessages.data.agent_name,
              agentMessages.data.process_task_id
            );

            let assigneeAgentIndex = resolveToolkitEventAgentIndex(
              taskAssigning,
              {
                agentId: agentMessages.data.agent_id,
                assigneeId: agentMessages.data.assignee_id,
                agentName: agentMessages.data.agent_name,
              },
              resolvedProcessTaskId
            );
            if (
              assigneeAgentIndex === -1 &&
              (isSingleAgentEventName(agentMessages.data.agent_name) ||
                tasks[currentTaskId].sessionMode === SessionMode.SINGLE_AGENT)
            ) {
              assigneeAgentIndex = ensureSingleAgentAssignment(
                taskAssigning,
                currentTaskId,
                agentMessages.data.agent_id
              );
            }
            if (assigneeAgentIndex !== -1) {
              const message = filterMessage(agentMessages);
              if (message) {
                const task = taskAssigning[assigneeAgentIndex].tasks.find(
                  (task: TaskInfo) => task.id === resolvedProcessTaskId
                );
                if (task) {
                  let index = task.toolkits?.findIndex((toolkit: any) => {
                    return (
                      toolkit.toolkitName === agentMessages.data.toolkit_name &&
                      toolkit.toolkitMethods ===
                        agentMessages.data.method_name &&
                      toolkit.toolkitStatus === AgentStatusValue.RUNNING
                    );
                  });

                  if (task.toolkits && index !== -1 && index !== undefined) {
                    task.toolkits[index].message =
                      `${normalizeToolkitMessage(task.toolkits[index].message)}\n${normalizeToolkitMessage(message.data.message)}`.trim();
                    task.toolkits[index].toolkitStatus =
                      AgentStatusValue.COMPLETED;
                  }
                  // task.toolkits?.unshift({
                  // 	toolkitName: agentMessages.data.toolkit_name as string,
                  // 	toolkitMethods: agentMessages.data.method_name as string,
                  // 	message: message.data.message as string,
                  // 	toolkitStatus: "completed",
                  // });
                  // task.toolkits?.unshift({
                  // 	toolkitName: agentMessages.data.toolkit_name as string,
                  // 	toolkitMethods: agentMessages.data.method_name as string,
                  // 	message: message.data.message as string,
                  // 	toolkitStatus: "completed",
                  // });
                }
                taskAssigning[assigneeAgentIndex].log.push(agentMessages);

                setTaskAssigning(currentTaskId, [...taskAssigning]);
              }
            }

            let taskRunning = [...tasks[currentTaskId].taskRunning];
            const { toolkit_name, method_name, message } = agentMessages.data;
            const taskIndex = taskRunning.findIndex(
              (task) => task.id === resolvedProcessTaskId
            );

            if (taskIndex !== -1) {
              if (toolkit_name && method_name && message) {
                const targetMessage = filterMessage(agentMessages);

                if (targetMessage) {
                  const runningToolkitIndex = taskRunning[
                    taskIndex
                  ].toolkits?.findLastIndex(
                    (toolkit) =>
                      toolkit.toolkitName === toolkit_name &&
                      toolkit.toolkitMethods === method_name &&
                      toolkit.toolkitStatus === AgentStatusValue.RUNNING
                  );
                  if (
                    taskRunning[taskIndex].toolkits &&
                    runningToolkitIndex !== undefined &&
                    runningToolkitIndex !== -1
                  ) {
                    taskRunning[taskIndex].toolkits[
                      runningToolkitIndex
                    ].message =
                      `${normalizeToolkitMessage(taskRunning[taskIndex].toolkits[runningToolkitIndex].message)}\n${normalizeToolkitMessage(targetMessage.data.message)}`.trim();
                    taskRunning[taskIndex].toolkits[
                      runningToolkitIndex
                    ].toolkitStatus = AgentStatusValue.COMPLETED;
                  } else {
                    taskRunning![taskIndex].toolkits ??= [];
                    taskRunning![taskIndex].toolkits?.push({
                      toolkitName: toolkit_name,
                      toolkitMethods: method_name,
                      message: normalizeToolkitMessage(
                        targetMessage.data.message
                      ),
                      toolkitStatus: AgentStatusValue.COMPLETED,
                    });
                  }
                }
              }
            }
            setTaskAssigning(currentTaskId, [...taskAssigning]);
            setTaskRunning(currentTaskId, taskRunning);
            return;
          }
          // Terminal
          if (agentMessages.step === AgentStep.TERMINAL) {
            const resolvedProcessTaskId = resolveProcessTaskIdForToolkitEvent(
              tasks,
              currentTaskId,
              agentMessages.data.agent_name,
              agentMessages.data.process_task_id
            );
            addTerminal(
              currentTaskId,
              resolvedProcessTaskId,
              agentMessages.data.output as string
            );
            return;
          }
          // Write File
          if (agentMessages.step === AgentStep.WRITE_FILE) {
            console.log('write_to_file', agentMessages.data);
            setNuwFileNum(currentTaskId, tasks[currentTaskId].nuwFileNum + 1);
            const { activeWorkspaceTab, markTabAsUnviewed } =
              usePageTabStore.getState();
            if (activeWorkspaceTab !== 'files' && project_id) {
              markTabAsUnviewed('files', project_id);
            }
            const { file_path } = agentMessages.data;
            const fileName =
              file_path?.replace(/\\/g, '/').split('/').pop() || '';
            const fileType = fileName.split('.').pop() || '';
            const fileInfo: FileInfo = {
              name: fileName,
              type: fileType,
              path: file_path || '',
              icon: FileText,
            };
            const resolvedProcessTaskId = resolveProcessTaskIdForToolkitEvent(
              tasks,
              currentTaskId,
              agentMessages.data.agent_name,
              agentMessages.data.process_task_id
            );
            addFileList(currentTaskId, resolvedProcessTaskId, fileInfo);
            return;
          }

          if (agentMessages.step === AgentStep.ARTIFACT_MANIFEST) {
            const lockedTaskId = getCurrentTaskId();
            const lockedTask = getCurrentChatStore().tasks[lockedTaskId];
            if (!lockedTask) return;
            lockedTask.artifactManifestFiles = normalizeTaskArtifactFileList(
              agentMessages.data.artifacts
            );
            lockedTask.artifactManifestScanStatus =
              typeof agentMessages.data.scan_status === 'string'
                ? agentMessages.data.scan_status
                : 'complete';
            lockedTask.artifactManifestTruncated =
              agentMessages.data.truncated === true;
            // A finalized manifest is the durable barrier even when discovery
            // explicitly records workspace_unavailable. Re-querying the live
            // filesystem during replay would invent a second, non-canonical
            // history and produces noisy 404s after Cloud restore.
            lockedTask.artifactManifestFinalized = true;
            setUpdateCount();
            return;
          }

          if (agentMessages.step === AgentStep.ARTIFACT_UPLOADED) {
            const lockedTaskId = getCurrentTaskId();
            const lockedTask = getCurrentChatStore().tasks[lockedTaskId];
            if (!lockedTask) return;
            const artifactId = agentMessages.data.artifact_id;
            const rawAsset = agentMessages.data.asset_ref;
            const assetKey = rawAsset?.key;
            if (
              typeof artifactId !== 'string' ||
              !rawAsset ||
              typeof rawAsset !== 'object' ||
              typeof assetKey !== 'string'
            ) {
              return;
            }
            lockedTask.artifactManifestFiles = (
              lockedTask.artifactManifestFiles || []
            ).map((file) =>
              file.artifactId === artifactId
                ? {
                    ...file,
                    assetRef: {
                      chatFileId:
                        typeof rawAsset.chat_file_id === 'number'
                          ? rawAsset.chat_file_id
                          : undefined,
                      key: assetKey,
                      bucket:
                        typeof rawAsset.bucket === 'string'
                          ? rawAsset.bucket
                          : undefined,
                      filename:
                        typeof rawAsset.filename === 'string'
                          ? rawAsset.filename
                          : undefined,
                      size:
                        typeof rawAsset.size === 'number'
                          ? rawAsset.size
                          : undefined,
                      contentType:
                        typeof rawAsset.content_type === 'string'
                          ? rawAsset.content_type
                          : undefined,
                    },
                  }
                : file
            );
            setUpdateCount();
            return;
          }

          if (agentMessages.step === AgentStep.BUDGET_NOT_ENOUGH) {
            console.log('error', agentMessages.data);
            showCreditsToast();
            setStatus(currentTaskId, ChatTaskStatus.PAUSE);
            uploadLog(currentTaskId, type);
            return;
          }

          if (agentMessages.step === AgentStep.CONTEXT_TOO_LONG) {
            console.error('Context too long:', agentMessages.data);
            const currentLength = agentMessages.data.current_length || 0;
            const maxLength = agentMessages.data.max_length || 100000;

            // Show toast notification
            toast.dismiss();
            toast.error(
              i18next.t('chat.context-limit-exceeded', {
                defaultValue:
                  '⚠️ Context limit exceeded\n\nThe conversation history is too long ({{currentLength}} / {{maxLength}} characters).\n\nStart a new session to continue your work.',
                currentLength: currentLength.toLocaleString(
                  i18next.resolvedLanguage || i18next.language
                ),
                maxLength: maxLength.toLocaleString(
                  i18next.resolvedLanguage || i18next.language
                ),
              }),
              {
                duration: Infinity,
                closeButton: true,
              }
            );

            // Set flag to block input and set status to pause
            setIsContextExceeded(currentTaskId, true);
            setStatus(currentTaskId, ChatTaskStatus.PAUSE);
            uploadLog(currentTaskId, type);
            return;
          }

          if (agentMessages.step === AgentStep.ERROR) {
            try {
              console.error('Model error:', agentMessages.data);

              // Validate that agentMessages.data exists before processing
              if (
                agentMessages.data === undefined ||
                agentMessages.data === null
              ) {
                throw new Error('Invalid error message format: missing data');
              }

              // Safely extract error message with fallback chain
              const errorMessage =
                agentMessages.data?.message ||
                (typeof agentMessages.data === 'string'
                  ? agentMessages.data
                  : null) ||
                i18next.t('chat.request-processing-error', {
                  defaultValue:
                    'An error occurred while processing your request',
                });
              const isProjectBusyError =
                errorMessage === 'Single Agent is already processing a task.';
              const isRetryableRunError =
                agentMessages.data?.retryable === true;

              // Freeze the live clock before switching to FINISHED. The work
              // log only advances taskTime while RUNNING; skipping this step
              // made every error path render "Worked for 0s".
              const failedTask = tasks[currentTaskId];
              const settledElapsed = settleTaskElapsedMs(
                failedTask,
                Date.now()
              );
              setTaskTime(currentTaskId, 0);
              setElapsed(currentTaskId, settledElapsed);
              get().setDurableRunStatus(currentTaskId, 'failed');

              // Mark all incomplete tasks as failed
              let taskRunning = [...tasks[currentTaskId].taskRunning];
              let taskAssigning = [...tasks[currentTaskId].taskAssigning];

              // Update taskRunning - mark non-completed tasks as failed
              taskRunning = taskRunning.map((task) => {
                if (
                  task.status !== TaskStatus.COMPLETED &&
                  task.status !== TaskStatus.FAILED
                ) {
                  task.status = TaskStatus.FAILED;
                }
                return task;
              });

              // Update taskAssigning - mark non-completed tasks as failed
              taskAssigning = taskAssigning.map((agent) => {
                agent.tasks = agent.tasks.map((task) => {
                  if (
                    task.status !== TaskStatus.COMPLETED &&
                    task.status !== TaskStatus.FAILED
                  ) {
                    task.status = TaskStatus.FAILED;
                  }
                  return task;
                });
                return agent;
              });

              // Apply the updates
              setTaskRunning(currentTaskId, taskRunning);
              setTaskAssigning(currentTaskId, taskAssigning);

              // Complete the current task with error status
              setActiveAsk(currentTaskId, '');
              setActiveAskList(currentTaskId, []);
              setStatus(currentTaskId, ChatTaskStatus.FINISHED);
              setIsPending(currentTaskId, false);

              // Add error message to the current task
              addMessages(currentTaskId, {
                id: generateUniqueId(),
                role: 'agent',
                content: i18next.t('chat.error-message', {
                  defaultValue: '❌ **Error**: {{message}}',
                  message: errorMessage,
                }),
              });
              // Record the tokens consumed before the failure so the run's
              // spend is not lost from the history row (a failed run
              // otherwise stays at zero tokens forever).
              if (!type && historyId && !isProjectBusyError) {
                const tokensSoFar = getTokens(currentTaskId);
                if (tokensSoFar > 0) {
                  proxyFetchPut(`/api/v1/chat/history/${historyId}`, {
                    tokens: tokensSoFar,
                  }).catch((err) => {
                    console.warn('History token update failed on error:', err);
                  });
                }
              }
              uploadLog(currentTaskId, type);
              // Analytics: task failed — split breakage vs disinterest.
              if (!type || type === 'normal') {
                recordTaskFailed({
                  error_type: classifyError(errorMessage),
                  is_project_busy: isProjectBusyError,
                  session_mode: tasks[currentTaskId]?.sessionMode,
                });
              }
              // Update trigger execution status to Failed on error
              updateTriggerExecutionStatus(
                getCurrentChatStore(),
                project_id,
                currentTaskId,
                ExecutionStatus.Failed,
                tasks[currentTaskId]?.tokens || 0,
                errorMessage
              );

              // A busy Project means another run in the same long conversation
              // is still active. Do not stop that active Project while marking
              // only this rejected run as failed.
              if (!isProjectBusyError && type !== 'replay') {
                try {
                  await fetchDelete(`/chat/${project_id}`);
                } catch (error) {
                  console.log('Task may not exist on backend:', error);
                }
              }
              if (isRetryableRunError && project_id) {
                notifyDurableRunStatusChanged(project_id);
                // The error SSE can reach the renderer a few milliseconds
                // before Coordinator commits runtime.interrupted. One bounded
                // follow-up closes that race without reinstating polling.
                window.setTimeout(
                  () => notifyDurableRunStatusChanged(project_id),
                  300
                );
              }
            } catch (error) {
              console.error('Failed to handle model error:', error);
              console.error('Original agentMessages:', agentMessages);

              // Fallback: try to create error task with minimal operations
              try {
                const {
                  create,
                  setActiveTaskId,
                  setHasWaitComfirm,
                  addMessages,
                } = get();
                const fallbackTaskId = create();
                setActiveTaskId(fallbackTaskId);
                setHasWaitComfirm(fallbackTaskId, true);
                addMessages(fallbackTaskId, {
                  id: generateUniqueId(),
                  role: 'agent',
                  content: i18next.t('chat.critical-model-error', {
                    defaultValue:
                      '**Critical error**: An unexpected error occurred while handling a model error. Refresh the application or contact support.',
                  }),
                });
              } catch (fallbackError) {
                console.error(
                  'Failed to create fallback error task:',
                  fallbackError
                );
                // Last resort: just log the error without creating UI elements
                console.error(
                  'Original error that could not be displayed:',
                  agentMessages
                );
              }
            }
            return;
          }

          // Handle add_task events for project store
          if (agentMessages.step === AgentStep.ADD_TASK) {
            try {
              const taskData = agentMessages.data;
              if (taskData && taskData.project_id && taskData.content) {
                console.log(
                  `Task added to project queue: ${taskData.project_id}`
                );
              }
            } catch (error) {
              const taskIdToRemove = agentMessages.data.task_id as string;
              const projectStore = useProjectStore.getState();
              //Remove the task from the queue on error
              if (project_id) {
                const project = projectStore.getProjectById(project_id);
                if (project && project.queuedMessages) {
                  const messageToRemove = project.queuedMessages.find(
                    (msg) => msg.task_id === taskIdToRemove
                  );
                  if (messageToRemove) {
                    projectStore.removeQueuedMessage(
                      project_id,
                      messageToRemove.task_id
                    );
                    console.log(
                      `Task removed from project queue: ${taskIdToRemove}`
                    );
                  }
                }
              }
              console.error('Error adding task to project store:', error);
            }
            return;
          }

          // Handle remove_task events for project store
          if (agentMessages.step === AgentStep.REMOVE_TASK) {
            try {
              const taskIdToRemove = agentMessages.data.task_id as string;
              if (taskIdToRemove) {
                const projectStore = useProjectStore.getState();
                const project_id = agentMessages.data.project_id as
                  string | undefined;
                if (project_id) {
                  const project = projectStore.getProjectById(project_id);
                  if (project && project.queuedMessages) {
                    const messageToRemove = project.queuedMessages.find(
                      (msg) => msg.task_id === taskIdToRemove
                    );
                    if (messageToRemove) {
                      projectStore.removeQueuedMessage(
                        project_id,
                        messageToRemove.task_id
                      );
                      void cancelFollowUpRequest(
                        project_id,
                        messageToRemove.task_id
                      ).catch(() => undefined);
                      console.log(
                        `Task removed from project queue: ${taskIdToRemove}`
                      );
                    }
                  }
                } else {
                  console.warn(
                    '[remove_task] Ignored queue mutation without project_id'
                  );
                }
              }
            } catch (error) {
              console.error('Error removing task from project store:', error);
            }
            return;
          }

          if (agentMessages.step === AgentStep.END) {
            const endData: unknown = agentMessages.data;
            const endMessageText = extractEndPayloadText(endData);
            const endTokens =
              typeof endData === 'object' &&
              endData !== null &&
              typeof (endData as { tokens?: unknown }).tokens === 'number'
                ? (endData as { tokens: number }).tokens
                : 0;
            if (endTokens > 0 && getTokens(currentTaskId) === 0) {
              addTokens(currentTaskId, endTokens);
            }
            clearRequestUsageStepTokens(currentTaskId);
            if (!currentTaskId || !tasks[currentTaskId]) return;
            // The Stop button hits backend's Action.skip_task, which also
            // yields an `end` SSE event with this fixed sentinel. Do not count
            // that as a successful completion for analytics metrics.
            const wasStoppedByUser = endMessageText.startsWith(
              '<summary>Task stopped</summary>'
            );
            get().setDurableRunStatus(
              currentTaskId,
              wasStoppedByUser ? 'stopped' : 'completed'
            );

            const endMessage = resolveEndMessageText(
              endMessageText,
              tasks[currentTaskId].messages,
              tasks[currentTaskId]
            );
            const endMessageId = generateUniqueId();
            const endUiMessage: Message = {
              id: endMessageId,
              role: 'agent',
              content: endMessage || '',
              step: agentMessages.step,
              isConfirm: false,
              fileList: [],
            };

            addMessages(currentTaskId, endUiMessage);
            setIsPending(currentTaskId, false);
            setActiveAsk(currentTaskId, '');
            setActiveAskList(currentTaskId, []);
            setStatus(currentTaskId, ChatTaskStatus.FINISHED);
            setUpdateCount();

            // Finish the local UI projection before any cloud upload or
            // history request. Camel-log and generated-file uploads can take
            // minutes on a large Run; keeping elapsed/artifacts behind those
            // network operations made a completed task temporarily render as
            // "Worked for 0s" with no Files changed section.
            const completedTask = tasks[currentTaskId];
            let completedElapsed = completedTask.elapsed;
            const playbackElapsed =
              type &&
              playbackFirstStepTimeMs !== null &&
              playbackLastStepTimeMs !== null
                ? Math.max(0, playbackLastStepTimeMs - playbackFirstStepTimeMs)
                : null;
            if (playbackElapsed !== null) {
              completedElapsed = playbackElapsed;
            } else if (completedTask.taskTime !== 0) {
              completedElapsed += Date.now() - completedTask.taskTime;
            }
            setTaskTime(currentTaskId, 0);
            setElapsed(currentTaskId, completedElapsed);

            const writeEventFiles = completedTask.taskAssigning.flatMap(
              (agent) =>
                agent.tasks.flatMap((assignedTask) =>
                  assignedTask.fileList ? assignedTask.fileList : []
                )
            );
            const outputProjectId =
              project_id || projectStore.activeProjectId || undefined;
            const taskArtifactFileList =
              completedTask.artifactManifestFinalized === true
                ? {
                    canonical: true,
                    files: completedTask.artifactManifestFiles || [],
                    scanStatus:
                      completedTask.artifactManifestScanStatus || 'complete',
                    truncated: completedTask.artifactManifestTruncated === true,
                  }
                : await loadTaskArtifactFileList({
                    taskId: currentTaskId,
                    projectId: outputProjectId,
                    email: email || undefined,
                    userId: user_id,
                  });
            if (taskArtifactFileList.canonical) {
              completedTask.artifactManifestScanStatus =
                taskArtifactFileList.scanStatus || 'complete';
              completedTask.artifactManifestTruncated =
                taskArtifactFileList.truncated;
            }
            const outputBaseURL = await getBaseURL().catch(() => '');
            const finalOutputFileList = extractFinalOutputFileList(
              endMessage,
              outputProjectId,
              email || undefined,
              outputBaseURL || undefined
            );
            const mergedFileList = resolveRunOutputFileList({
              writeEventFiles,
              artifactFiles: taskArtifactFileList.files,
              canonicalArtifactsAvailable: taskArtifactFileList.canonical,
              finalAnswerFiles: finalOutputFileList,
            });
            updateMessage(currentTaskId, endMessageId, {
              ...endUiMessage,
              fileList: mergedFileList,
            });

            // Analytics: task outcome. Skip replay/share playback so only real
            // runs are measured, and keep stopped runs out of completion metrics.
            if (!type || type === 'normal') {
              const completedTask = tasks[currentTaskId];
              const completedProjectName = (
                project_id ? projectStore.getProjectById(project_id) : null
              )?.name;
              const taskOutcomeProperties = {
                session_mode: completedTask?.sessionMode,
                agent_count: completedTask?.taskAssigning?.length ?? 0,
                has_mcp: getWorkerList().some(
                  (w) => (w.workerInfo?.mcp_tools?.length ?? 0) > 0
                ),
                duration_seconds: completedTask?.createdAt
                  ? Math.round((Date.now() - completedTask.createdAt) / 1000)
                  : undefined,
                tokens: getTokens(currentTaskId),
                // Classify the task on-device for low-cardinality reporting;
                // the raw project name / summary (user content) is not sent.
                task_category: classifyTaskCategory(
                  `${completedProjectName ?? ''} ${completedTask?.summaryTask ?? ''}`
                ),
              };
              if (wasStoppedByUser) {
                recordTaskStopped({
                  ...taskOutcomeProperties,
                  stop_reason: 'user_requested',
                });
              } else {
                recordTaskCompleted(taskOutcomeProperties);
              }
            }

            // compute task time
            console.log(
              'tasks[taskId].snapshotsTemp',
              tasks[currentTaskId].snapshotsTemp
            );
            Promise.all(
              tasks[currentTaskId].snapshotsTemp.map((snapshot) =>
                proxyFetchPost(`/api/v1/chat/snapshots`, { ...snapshot })
              )
            );

            const uploadTargetId = (project_id ||
              projectStore.activeProjectId) as string | undefined;
            if (!type && import.meta.env.VITE_USE_LOCAL_PROXY !== 'true') {
              if (!uploadTargetId) {
                console.warn(
                  'Skip file upload because no active project ID was found'
                );
              } else {
                const hostIpcRenderer = getHostIpcRenderer();
                if (!hostIpcRenderer?.invoke) {
                  console.warn(
                    'Skip file upload because IPC renderer is unavailable'
                  );
                } else {
                  try {
                    const camelLogFiles =
                      ((await hostIpcRenderer.invoke(
                        'get-camel-log-file-list',
                        email,
                        currentTaskId,
                        uploadTargetId,
                        user_id
                      )) as CamelLogUploadFile[]) || [];
                    const legacyTaskOutputFiles = tasks[
                      currentTaskId
                    ].taskAssigning.flatMap((agent) =>
                      agent.tasks.flatMap((task) => task.fileList || [])
                    );
                    const taskOutputFiles =
                      completedTask.artifactManifestFinalized === true
                        ? completedTask.artifactManifestFiles || []
                        : legacyTaskOutputFiles;
                    const filesToUpload = collectTaskUploadFiles(
                      camelLogFiles,
                      tasks[currentTaskId].messages,
                      tasks[currentTaskId].attaches,
                      taskOutputFiles
                    );
                    console.log('Task upload files collected:', {
                      camelLogFileCount: camelLogFiles.length,
                      taskOutputFileCount: taskOutputFiles.length,
                      uploadCandidateCount: filesToUpload.length,
                      uploadTargetId,
                      taskId: currentTaskId,
                    });

                    if (filesToUpload.length > 0) {
                      const uploadResults = await uploadTaskFiles(
                        filesToUpload,
                        uploadTargetId
                      );
                      const failedUploads = uploadResults.filter(
                        (result) => !result.success
                      );
                      if (failedUploads.length > 0) {
                        console.error('Failed to upload files:', failedUploads);
                      }
                    }
                  } catch (error) {
                    console.error(
                      'Failed to prepare task files for upload:',
                      error
                    );
                  }
                }
              }
            }

            if (!type && historyId) {
              try {
                const st = tasks[currentTaskId].summaryTask || '';
                const parts = st.split('|');
                const rawEndPayload = endMessageText;
                const completionSummary = rawEndPayload || parts[1] || '';
                // Treat the run as ongoing so chat_history.status accurately
                // reflects whether the project actually completed; the
                // history-replay polish keys off this flag.
                const projectName = parts[0] || '';
                const obj = {
                  project_name: projectName,
                  summary: clampHistorySummary(completionSummary),
                  status: wasStoppedByUser ? 1 : 2,
                  tokens: getTokens(currentTaskId),
                };
                syncProjectDisplayName(project_id, projectName);
                proxyFetchPut(`/api/v1/chat/history/${historyId}`, obj);
              } catch (e) {
                console.warn('History update failed on END:', e);
              }
            }
            uploadLog(currentTaskId, type);

            let taskRunning = [...tasks[currentTaskId].taskRunning];
            let taskAssigning = [...tasks[currentTaskId].taskAssigning];
            taskAssigning = taskAssigning.map((agent) => {
              agent.tasks = agent.tasks.map((task) => {
                if (
                  task.status !== TaskStatus.COMPLETED &&
                  task.status !== TaskStatus.FAILED &&
                  !type
                ) {
                  task.status = TaskStatus.SKIPPED;
                }
                return task;
              });
              return agent;
            });

            taskRunning = taskRunning.map((task) => {
              if (
                task.status !== TaskStatus.COMPLETED &&
                task.status !== TaskStatus.FAILED &&
                !type
              ) {
                task.status = TaskStatus.SKIPPED;
              }
              return task;
            });
            setTaskAssigning(currentTaskId, [...taskAssigning]);
            setTaskRunning(currentTaskId, [...taskRunning]);

            console.log(tasks[currentTaskId], 'end');

            // Update trigger execution status to Completed
            updateTriggerExecutionStatus(
              getCurrentChatStore(),
              project_id,
              currentTaskId,
              ExecutionStatus.Completed,
              getTokens(currentTaskId)
            );

            // The run is finished; drop its SSE controller so a completed
            // task no longer counts as an active run (e.g. the close guard).
            delete activeSSEControllers[newTaskId];

            return;
          }
          if (agentMessages.step === AgentStep.NOTICE) {
            if (agentMessages.data.process_task_id !== '') {
              let taskAssigning = [...tasks[currentTaskId].taskAssigning];

              const assigneeAgentIndex = taskAssigning!.findIndex(
                (agent: Agent) =>
                  agent.tasks.find(
                    (task: TaskInfo) =>
                      task.id === agentMessages.data.process_task_id
                  )
              );
              // Single-agent runs never emit `assign_task`, so no agent
              // ever owns this notice's process_task_id and the findIndex
              // above returns -1. Optional chaining keeps the access safe;
              // the existing guard at the bottom of this block already
              // skips the toolkit push when the index is -1.
              const task = taskAssigning[assigneeAgentIndex]?.tasks.find(
                (task: TaskInfo) =>
                  task.id === agentMessages.data.process_task_id
              );
              const toolkit = {
                toolkitId: generateUniqueId(),
                toolkitName: 'notice',
                toolkitMethods: '',
                message: agentMessages.data.notice as string,
                toolkitStatus: AgentStatusValue.RUNNING,
              };
              if (assigneeAgentIndex !== -1 && task) {
                task.toolkits ??= [];
                task.toolkits.push({ ...toolkit });
                // Mirror the notice onto the agent log so the work-log
                // timeline can render it inline alongside tool calls.
                taskAssigning[assigneeAgentIndex].log.push(agentMessages);
              }
              setTaskAssigning(currentTaskId, [...taskAssigning]);
            } else {
              const messages = [...tasks[currentTaskId].messages];
              const noticeCardIndex = messages.findLastIndex(
                (message) => message.step === AgentStep.NOTICE_CARD
              );
              if (noticeCardIndex === -1) {
                const newMessage: Message = {
                  id: generateUniqueId(),
                  role: 'agent',
                  content: '',
                  step: AgentStep.NOTICE_CARD,
                };
                addMessages(currentTaskId, newMessage);
              }
              setCotList(currentTaskId, [
                ...tasks[currentTaskId].cotList,
                agentMessages.data.notice as string,
              ]);
            }
            return;
          }
          if (agentMessages.step === AgentStep.SYNC) return;
          if (agentMessages.step === AgentStep.HUMAN_REPLY) {
            const resolvedInteractionId =
              typeof agentMessages.data?.interaction_id === 'string'
                ? agentMessages.data.interaction_id
                : null;
            let interactionWasAlreadyResolved = false;
            if (resolvedInteractionId) {
              const currentStore = getCurrentChatStore();
              interactionWasAlreadyResolved =
                currentStore.tasks[
                  currentTaskId
                ]?.resolvedInteractionIds?.includes(resolvedInteractionId) ===
                true;
              currentStore.markHumanInteractionResolved(
                currentTaskId,
                resolvedInteractionId
              );
            }
            // A local decision closes and advances the queue immediately.
            // When the canonical decision later arrives, it is confirmation,
            // not a second signal to consume another queued interaction.
            if (interactionWasAlreadyResolved) return;
            const reply =
              agentMessages.data?.reply ||
              agentMessages.data?.content ||
              (typeof agentMessages.data === 'string'
                ? agentMessages.data
                : '');
            if (reply) {
              addMessages(currentTaskId, {
                id: generateUniqueId(),
                role: 'user',
                content: reply,
                interactionResponseTo:
                  agentMessages.data?.interaction_id || undefined,
              });
            }

            const latestTask =
              getCurrentChatStore().tasks[currentTaskId] ||
              tasks[currentTaskId];
            const [nextAsk, ...remainingAsks] = latestTask.askList;
            setActiveAskList(currentTaskId, remainingAsks);
            if (nextAsk) {
              setActiveAsk(currentTaskId, nextAsk.agent_name || '');
              addMessages(currentTaskId, nextAsk);
            } else {
              setActiveAsk(currentTaskId, '');
            }
            setIsPending(currentTaskId, false);
            return;
          }
          if (agentMessages.step === AgentStep.ASK) {
            const interactionId =
              typeof agentMessages.data?.interaction_id === 'string'
                ? agentMessages.data.interaction_id
                : null;
            const currentTask = getCurrentChatStore().tasks[currentTaskId];
            if (
              interactionId &&
              hasProjectedHumanInteraction(currentTask, interactionId)
            ) {
              return;
            }
            const newMessage: Message = {
              id: generateUniqueId(),
              role: 'agent',
              agent_name: agentMessages.data.agent || '',
              content: extractAgentMessageContent(agentMessages.data),
              step: agentMessages.step,
              isConfirm: false,
              interaction:
                agentMessages.data?.interaction_id &&
                agentMessages.data?.interaction_type
                  ? ({ ...agentMessages.data } as Message['interaction'])
                  : undefined,
            };

            if (tasks[currentTaskId].activeAsk != '') {
              let activeAskList = tasks[currentTaskId].askList;
              setActiveAskList(currentTaskId, [...activeAskList, newMessage]);
              return;
            }
            // Playback ASK state is read-only: ChatBox excludes replay/share
            // tasks from live input timers. Keeping the state here lets a
            // recorded HUMAN_REPLY promote queued historical questions in
            // the same order as the original run.
            setActiveAsk(currentTaskId, agentMessages.data.agent || '');
            setIsPending(currentTaskId, false);
            addMessages(currentTaskId, newMessage);
            return;
          }
          const newMessage: Message = {
            id: generateUniqueId(),
            role: 'agent',
            content: extractAgentMessageContent(agentMessages.data),
            step: agentMessages.step,
            isConfirm: false,
          };
          addMessages(currentTaskId, newMessage);
        },
        async onopen(respond) {
          console.log('open', respond);
          const contentType = respond.headers.get('content-type') || '';
          if (!respond.ok || !contentType.startsWith('text/event-stream')) {
            let detail = `HTTP ${respond.status}`;
            let errorCode: string | undefined;
            let userMessage: string | undefined;
            try {
              const body = await respond.clone().json();
              const bodyDetail = body?.detail ?? body?.message ?? body?.text;
              if (typeof bodyDetail === 'string') {
                detail = bodyDetail;
                userMessage = bodyDetail;
              } else if (bodyDetail) {
                detail = JSON.stringify(bodyDetail);
                if (typeof bodyDetail?.code === 'string') {
                  errorCode = bodyDetail.code;
                }
                if (typeof bodyDetail?.message === 'string') {
                  userMessage = bodyDetail.message;
                }
              }
            } catch {
              // Preserve the HTTP fallback for non-JSON error responses.
            }
            const error: any = new Error(
              contentType.startsWith('text/event-stream')
                ? `Run stream returned ${detail}`
                : `Run admission did not return an event stream: ${detail}`
            );
            error.status = respond.status;
            error.code = errorCode;
            error.userMessage = userMessage;
            rejectResumeStreamOpen?.(error);
            throw error;
          }
          resumeStreamOpened = true;
          resolveResumeStreamOpen?.();
          if (!type && project_id) {
            runEventIngressRegistry.ensureLocal(project_id, newTaskId);
          }
          const { setAttaches, activeTaskId } = get();
          setAttaches(activeTaskId as string, []);
          return;
        },

        onerror(err) {
          console.error('[fetchEventSource] Error:', err);

          // Do not retry if the task has already finished (avoids duplicate execution
          // after ERR_NETWORK_CHANGED, ERR_INTERNET_DISCONNECTED, sleep/wake - see issue #1212)
          const currentStore = getCurrentChatStore();
          const lockedId = getCurrentTaskId();
          const task = currentStore.tasks[lockedId];
          if (task?.status === ChatTaskStatus.FINISHED) {
            console.log(
              `[fetchEventSource] Task ${lockedId} already finished, stopping retry to avoid duplicate execution`
            );
            try {
              if (activeSSEControllers[newTaskId]) {
                delete activeSSEControllers[newTaskId];
              }
            } catch (cleanupError) {
              console.warn(
                'Error cleaning up AbortController on finished task:',
                cleanupError
              );
            }
            throw err;
          }

          // Allow automatic retry for connection errors only when task is not finished
          const isConnectionError =
            err instanceof TypeError ||
            err?.message?.includes('Failed to fetch') ||
            err?.message?.includes('ECONNREFUSED') ||
            err?.message?.includes('NetworkError') ||
            err?.message?.includes('ERR_NETWORK_CHANGED') ||
            err?.message?.includes('ERR_INTERNET_DISCONNECTED');
          if (isConnectionError) {
            console.warn(
              '[fetchEventSource] Connection error detected, will retry automatically...'
            );
            return;
          }

          if (!resumeStreamOpened) rejectResumeStreamOpen?.(err);

          if (!resumeStreamOpened) {
            // Admission failed before the event stream existed. Unlike an
            // execution error, no later END frame can clear the optimistic
            // pending state, so close it here and surface the typed Brain
            // reason instead of leaving the composer stuck on "Preparing".
            finishStartupFailure();
            const failureState = targetChatStore.getState();
            const failureTask = failureState.tasks[newTaskId];
            const userMessage =
              typeof err?.userMessage === 'string' && err.userMessage.trim()
                ? err.userMessage.trim()
                : typeof err?.message === 'string' && err.message.trim()
                  ? err.message.trim()
                  : i18next.t('chat.task-admission-failed', {
                      defaultValue:
                        'The task could not be started. Please try again.',
                    });
            const isContinuationClarification =
              typeof err?.code === 'string' &&
              err.code.startsWith('continuation_');
            const content = isContinuationClarification
              ? i18next.t('chat.control-input-required-message', {
                  defaultValue: 'Input required: {{message}}',
                  message: userMessage,
                })
              : i18next.t('chat.error-message', {
                  defaultValue: '❌ **Error**: {{message}}',
                  message: userMessage,
                });
            const alreadyRendered = failureTask?.messages.some(
              (message) =>
                message.role === 'agent' && message.content === content
            );
            if (failureTask && !alreadyRendered) {
              failureState.addMessages(newTaskId, {
                id: generateUniqueId(),
                role: 'agent',
                content,
              });
            }
          }

          const currentTaskId = getCurrentTaskId();
          // Update trigger execution status to Completed for connection closed by server
          updateTriggerExecutionStatus(
            getCurrentChatStore(),
            project_id,
            currentTaskId,
            ExecutionStatus.Cancelled,
            getCurrentChatStore().tasks[currentTaskId]?.tokens || 0
          );

          // For other errors, log and throw to stop retrying
          console.error(
            '[fetchEventSource] Fatal error, stopping connection:',
            err
          );

          // Clean up AbortController on error with robust error handling
          try {
            if (activeSSEControllers[newTaskId]) {
              delete activeSSEControllers[newTaskId];
              console.log(
                `Cleaned up SSE controller for task ${newTaskId} after error`
              );
            }
          } catch (cleanupError) {
            console.warn(
              'Error cleaning up AbortController on SSE error:',
              cleanupError
            );
          }
          throw err;
        },

        // Server closes connection
        onclose() {
          console.log('SSE connection closed');
          if (type) {
            const currentStore = getCurrentChatStore();
            const currentTaskId = getCurrentTaskId();
            const currentTask = currentStore.tasks[currentTaskId];
            if (currentTask?.isPending) {
              currentStore.setIsPending(currentTaskId, false);
            }
            if (currentTask && currentTask.status !== ChatTaskStatus.FINISHED) {
              currentStore.setStatus(currentTaskId, ChatTaskStatus.FINISHED);
            }
          }
          // Abort to resolve fetchEventSource promise (for replay/load - allows awaiting completion)
          try {
            abortController.abort();
          } catch (_e) {
            // Ignore if already aborted
          }
          // Clean up AbortController when connection closes with robust error handling
          try {
            if (activeSSEControllers[newTaskId]) {
              delete activeSSEControllers[newTaskId];
              console.log(
                `Cleaned up SSE controller for task ${newTaskId} after connection close`
              );
            }
          } catch (cleanupError) {
            console.warn(
              'Error cleaning up AbortController on SSE close:',
              cleanupError
            );
          }
        },
      });
      if (resumeStreamOpenPromise) {
        try {
          await Promise.race([
            resumeStreamOpenPromise,
            ssePromise.then(() => {
              if (!resumeStreamOpened) {
                throw new Error(
                  'Run stream closed before Resume admission completed'
                );
              }
            }),
          ]);
        } catch (error) {
          finishStartupFailure();
          abortController.abort();
          await ssePromise.catch(() => undefined);
          throw error;
        }
        // The caller only waits for admission. Runtime streaming continues in
        // the background and retains the existing reconnect behavior.
        void ssePromise.catch((error) => {
          console.error(`SSE stream failed for task ${newTaskId}:`, error);
        });
      }
      if (replayCaughtUpPromise) {
        try {
          await Promise.race([
            replayCaughtUpPromise,
            ssePromise.then(() => {
              if (!replayCaughtUp) {
                throw new Error(
                  `Canonical Run ${newTaskId} stream closed before replay caught up`
                );
              }
            }),
          ]);
          if (localDurableLegacyEventCount === 0) {
            throw new Error(
              `Canonical Run ${newTaskId} contained no legacy UI events`
            );
          }
        } catch (error) {
          abortController.abort();
          await ssePromise.catch(() => undefined);
          throw error;
        }
        // History is now complete enough to render. The same transport keeps
        // reducing subsequently committed events until this Run terminates.
        void ssePromise.catch((error) => {
          console.error(`SSE stream failed for task ${newTaskId}:`, error);
        });
        return;
      }
      if (!resumeStreamOpenPromise && type !== 'replay') {
        // Live starts intentionally return after admission scheduling. Always
        // observe the transport promise so a typed 4xx admission response is
        // rendered by onerror without becoming an unhandled rejection.
        void ssePromise.catch((error) => {
          console.error(`SSE admission failed for task ${newTaskId}:`, error);
        });
      }
      if (type === 'replay') {
        try {
          await ssePromise;
          if (
            startOptions.replaySource === 'local_durable' &&
            localDurableLegacyEventCount === 0
          ) {
            throw new Error(
              `Canonical Run ${newTaskId} contained no legacy UI events`
            );
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            // Expected: stream closed normally, we aborted to resolve the promise
            if (
              startOptions.replaySource === 'local_durable' &&
              localDurableLegacyEventCount === 0
            ) {
              throw new Error(
                `Canonical Run ${newTaskId} contained no legacy UI events`
              );
            }
            return;
          }
          // Unexpected: actual error during stream
          console.error(`SSE stream failed for task ${newTaskId}:`, err);
          throw err; // Let loadProjectFromHistory handle it
        }
      }
    },

    replay: async (
      taskId: string,
      question: string,
      time: number,
      projectId?: string,
      source: 'cloud' | 'local_durable' = 'cloud',
      options?: ReplayTaskOptions
    ) => {
      const {
        create,
        setHasMessages,
        addMessages,
        startTask,
        setActiveTaskId,
        handleConfirmTask,
        setIsPending,
        setStatus,
      } = get();
      //get project id
      const project_id =
        projectId || useProjectStore.getState().activeProjectId;
      if (!project_id) {
        console.error("Can't replay task because no project id provided");
        return;
      }

      const resetReplayTask = () => {
        create(taskId, 'replay');
        setHasMessages(taskId, true);
        addMessages(taskId, {
          id: generateUniqueId(),
          role: 'user',
          content: question.split('|')[0],
        });
      };

      const startReplay = (replaySource: 'cloud' | 'local_durable') =>
        startTask(
          taskId,
          'replay',
          undefined,
          time,
          undefined,
          undefined,
          undefined,
          project_id,
          undefined,
          {
            replaySource,
            detachReplayAfterCatchUp:
              replaySource === 'local_durable' &&
              options?.detachAfterCatchUp === true,
          }
        );

      resetReplayTask();

      try {
        try {
          await startReplay(source);
        } catch (localReplayError) {
          if (source !== 'local_durable') {
            throw localReplayError;
          }
          console.warn(
            `[ChatStore] Canonical replay failed for ${taskId}; falling back to cloud playback`,
            localReplayError
          );
          resetReplayTask();
          await startReplay('cloud');
        }
        setActiveTaskId(taskId);
        handleConfirmTask(project_id, taskId, 'replay');
      } catch (error) {
        console.error(`Failed to replay task ${taskId}:`, error);
        const task = get().tasks[taskId];
        if (task) {
          if (task.isPending) {
            setIsPending(taskId, false);
          }
          if (task.status !== ChatTaskStatus.FINISHED) {
            setStatus(taskId, ChatTaskStatus.FINISHED);
          }
          const replayUnavailableMessage = i18next.t(
            'chat.legacy-task-replay-unavailable',
            {
              defaultValue:
                'Unable to replay this legacy task. The saved playback data could not be loaded.',
            }
          );
          const hasReplayErrorMessage = hasLegacyReplayUnavailableMessage(
            task.messages,
            replayUnavailableMessage
          );
          if (!hasReplayErrorMessage) {
            addMessages(taskId, {
              id: generateUniqueId(),
              role: 'agent',
              content: replayUnavailableMessage,
            });
          }
        }
        throw error;
      }
    },
    setUpdateCount() {
      set((state) => ({
        ...state,
        updateCount: state.updateCount + 1,
      }));
    },
    setActiveTaskId: (taskId: string) => {
      set({
        activeTaskId: taskId,
      });
    },
    setTaskSessionMode: (taskId: string, mode: SessionModeType) => {
      set((state) => {
        const task = state.tasks[taskId];
        if (!task || task.sessionMode === mode) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...task,
              sessionMode: mode,
            },
          },
        };
      });
    },
    addMessages(taskId, message) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            messages: [...state.tasks[taskId].messages, message],
          },
        },
      }));
    },
    setAttaches(taskId, attaches) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            attaches: [...attaches],
          },
        },
      }));
    },
    setMessages(taskId, messages) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            messages: [...messages],
          },
        },
      }));
    },
    removeMessage(taskId, messageId) {
      set((state) => {
        if (!state.tasks[taskId]) {
          return state;
        }
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              messages: state.tasks[taskId].messages.filter(
                (message) => message.id !== messageId
              ),
            },
          },
        };
      });
    },
    markHumanInteractionResolved(taskId, interactionId) {
      set((state) => {
        const task = state.tasks[taskId];
        if (!task || !interactionId) return state;
        const resolvedInteractionIds = task.resolvedInteractionIds || [];
        const alreadyResolved = resolvedInteractionIds.includes(interactionId);
        const messages = removeResolvedInteractionMessages(
          task.messages,
          interactionId
        );
        const askList = removeResolvedInteractionMessages(
          task.askList,
          interactionId
        );
        if (
          alreadyResolved &&
          messages.length === task.messages.length &&
          askList.length === task.askList.length
        ) {
          return state;
        }
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...task,
              messages,
              askList,
              resolvedInteractionIds: alreadyResolved
                ? resolvedInteractionIds
                : [...resolvedInteractionIds, interactionId],
            },
          },
        };
      });
    },
    setCotList(taskId, cotList) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            cotList: [...cotList],
          },
        },
      }));
    },

    setSummaryTask(taskId, summaryTask) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            summaryTask,
          },
        },
      }));
    },
    setIsTakeControl(taskId, isTakeControl) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            isTakeControl,
          },
        },
      }));
    },
    setHasWaitComfirm(taskId, hasWaitComfirm) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            hasWaitComfirm,
          },
        },
      }));
    },
    setTaskInfo(taskId, taskInfo) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            taskInfo: [...taskInfo],
          },
        },
      }));
    },
    setTaskRunning(taskId, taskRunning) {
      const { computedProgressValue } = get();
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            taskRunning: [...taskRunning],
          },
        },
      }));
      computedProgressValue(taskId);
    },
    addWebViewUrl(taskId: string, webViewUrl: string, processTaskId: string) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            webViewUrls: [
              ...state.tasks[taskId].webViewUrls,
              { url: webViewUrl, processTaskId: processTaskId },
            ],
          },
        },
      }));
    },
    setWebViewUrls(
      taskId: string,
      webViewUrls: { url: string; processTaskId: string }[]
    ) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            webViewUrls: [...webViewUrls],
          },
        },
      }));
    },
    setActiveAskList(taskId, askList) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            askList: [...askList],
          },
        },
      }));
    },
    setTaskAssigning(taskId, taskAssigning) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            taskAssigning: [...taskAssigning],
          },
        },
      }));
    },
    setStatus(taskId: string, status: ChatTaskStatusType) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            status,
          },
        },
      }));
    },
    setDurableRunStatus(
      taskId: string,
      durableRunStatus: DurableRunDisplayStatus | undefined
    ) {
      set((state) => {
        const task = state.tasks[taskId];
        if (!task) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...task,
              durableRunStatus,
            },
          },
        };
      });
    },
    handleConfirmTask: async (
      project_id: string,
      taskId: string,
      type?: string
    ) => {
      const {
        tasks,
        setMessages,
        setActiveWorkspace,
        setStatus,
        setTaskTime,
        setTaskInfo,
        setTaskRunning,
        setPlanDirty,
        setAutoConfirmDeadline,
      } = get();
      if (!taskId) return;
      const task = tasks[taskId];
      if (!task) return;

      const setLatestPlanConfirmed = (isConfirm: boolean) => {
        const latestTask = get().tasks[taskId];
        if (!latestTask) return;
        const messages = [...latestTask.messages];
        const cardTaskIndex = messages.findLastIndex(
          (message) => message.step === AgentStep.TO_SUB_TASKS
        );
        if (cardTaskIndex === -1) return;
        messages[cardTaskIndex] = {
          ...messages[cardTaskIndex],
          isConfirm,
          taskType: isConfirm ? 2 : messages[cardTaskIndex].taskType,
        };
        setMessages(taskId, messages);
      };

      // Stop any pending auto-confirm timers for this task (manual confirmation)
      try {
        if (autoConfirmTimers[taskId]) {
          clearTimeout(autoConfirmTimers[taskId]);
          delete autoConfirmTimers[taskId];
        }
        setAutoConfirmDeadline(taskId, null);
      } catch (error) {
        console.warn(
          'Error clearing auto-confirm timer in handleConfirmTask:',
          error
        );
      }

      // Live confirmation starts a new execution clock. Replay clocks are
      // reconstructed from persisted event/canonical Attempt timestamps;
      // resetting them here would make a restored long Run appear newly
      // started after its backlog finishes loading.
      if (type !== 'replay') {
        setTaskTime(taskId, Date.now());
      }
      // Filter out empty tasks from the user-edited taskInfo
      const taskInfo = task.taskInfo.filter((task) => task.content !== '');
      setTaskInfo(taskId, taskInfo);
      // Sync taskRunning with the filtered taskInfo (user edits should be reflected
      setTaskRunning(
        taskId,
        taskInfo.map((task) => ({ ...task }))
      );

      // IMPORTANT: Set isConfirm BEFORE sending API requests to prevent race condition
      // where backend sends to_sub_tasks SSE event before we mark task as confirmed
      setLatestPlanConfirmed(true);

      if (!type) {
        try {
          await fetchPut(`/task/${project_id}`, {
            task: taskInfo,
          });
          await fetchPost(`/task/${project_id}/start`, {});

          setActiveWorkspace(taskId, 'workflow');
          setStatus(taskId, ChatTaskStatus.RUNNING);
        } catch (error) {
          console.error('Failed to confirm and start task:', error);
          setLatestPlanConfirmed(false);
          setStatus(taskId, ChatTaskStatus.PENDING);
          setTaskTime(taskId, 0);
          toast.error(
            i18next.t('layout.failed-to-start-task', {
              defaultValue: 'Failed to start task. Please try again.',
            })
          );
          return;
        }
      }

      // Reset editing state after manual confirmation so next round can auto-start
      setPlanDirty(taskId, false);
    },
    addTaskInfo() {
      const { tasks, activeTaskId, setTaskInfo } = get();
      if (!activeTaskId) return;
      let targetTaskInfo = [...tasks[activeTaskId].taskInfo];
      const newTaskInfo = {
        id: '',
        content: '',
      };
      targetTaskInfo.push(newTaskInfo);
      setTaskInfo(activeTaskId, targetTaskInfo);
      // No backend persist here — the new task is empty, so it gets filtered out.
      // It will be persisted once the user types content (via updateTaskInfo).
    },
    addTerminal(taskId, processTaskId, terminal) {
      if (!processTaskId) return;
      const { tasks, setTaskAssigning } = get();
      const taskAssigning = [...tasks[taskId].taskAssigning];
      const taskAssigningIndex = taskAssigning.findIndex((task) =>
        task.tasks.find((task) => task.id === processTaskId)
      );
      if (taskAssigningIndex !== -1) {
        const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex(
          (task) => task.id === processTaskId
        );
        taskAssigning[taskAssigningIndex].tasks[taskIndex].terminal ??= [];
        taskAssigning[taskAssigningIndex].tasks[taskIndex].terminal?.push(
          terminal
        );
        console.log(
          taskAssigning[taskAssigningIndex].tasks[taskIndex].terminal
        );
        setTaskAssigning(taskId, taskAssigning);
      }
    },
    setActiveAsk(taskId, agentName) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            activeAsk: agentName,
          },
        },
      }));
    },
    setProgressValue(taskId: string, progressValue: number) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            progressValue,
          },
        },
      }));
    },
    setIsPending(taskId: string, isPending: boolean) {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              isPending,
            },
          },
        };
      });
    },
    setActiveWorkspace(taskId: string, activeWorkspace: string) {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              activeWorkspace,
            },
          },
        };
      });
    },
    setActiveAgent(taskId: string, agent_id: string) {
      console.log('setActiveAgent', taskId, agent_id);

      set((state) => {
        if (!state.tasks[taskId]) return state;
        if (state.tasks[taskId]?.activeAgent === agent_id) {
          return state;
        }
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              activeAgent: agent_id,
            },
          },
        };
      });
    },
    setHasMessages(taskId: string, hasMessages: boolean) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            hasMessages,
          },
        },
      }));
    },
    setHasAddWorker(taskId: string, hasAddWorker: boolean) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            hasAddWorker,
          },
        },
      }));
    },
    addFileList(taskId, processTaskId, fileInfo) {
      const { tasks, setTaskAssigning } = get();
      const taskAssigning = [...tasks[taskId].taskAssigning];
      let agentId = '';
      const taskAssigningIndex = taskAssigning.findIndex((agent) => {
        const hasTask = agent.tasks.find((task) => task.id === processTaskId);
        if (hasTask) {
          agentId = agent.agent_id;
        }
        return hasTask;
      });
      if (taskAssigningIndex !== -1) {
        const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex(
          (task) => task.id === processTaskId
        );
        if (taskIndex !== -1) {
          taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList ??= [];
          taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList?.push({
            ...fileInfo,
            agent_id: agentId,
            task_id: processTaskId,
          });
          setTaskAssigning(taskId, taskAssigning);
        }
      }
    },
    setFileList(taskId, processTaskId, fileList: FileInfo[]) {
      const { tasks, setTaskAssigning } = get();
      const taskAssigning = [...tasks[taskId].taskAssigning];

      const taskAssigningIndex = taskAssigning.findIndex((task) =>
        task.tasks.find((task) => task.id === processTaskId)
      );
      const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex(
        (task) => task.id === processTaskId
      );
      if (taskAssigningIndex !== -1) {
        taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList = [
          ...fileList,
        ];
        setTaskAssigning(taskId, taskAssigning);
      }
    },
    updateTaskInfo(index: number, content: string) {
      const { tasks, activeTaskId, setTaskInfo } = get();
      if (!activeTaskId) return;
      const targetTaskInfo = tasks[activeTaskId].taskInfo.map((item, i) =>
        i === index ? { ...item, content } : item
      );
      setTaskInfo(activeTaskId, targetTaskInfo);
    },
    saveTaskInfo() {
      const { tasks, activeTaskId } = get();
      if (!activeTaskId) return;
      persistSubtaskEdits(tasks[activeTaskId].taskInfo);
    },
    deleteTaskInfo(index: number) {
      const { tasks, activeTaskId, setTaskInfo } = get();
      if (!activeTaskId) return;
      const targetTaskInfo = [...tasks[activeTaskId].taskInfo];
      targetTaskInfo.splice(index, 1);
      setTaskInfo(activeTaskId, targetTaskInfo);
    },
    getLastUserMessage() {
      const { activeTaskId, tasks } = get();
      if (!activeTaskId) return null;
      return (
        tasks[activeTaskId]?.messages.findLast(
          (message: Message) => message.role === 'user'
        ) || null
      );
    },
    setTaskTime(taskId: string, taskTime: number) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            taskTime,
          },
        },
      }));
    },
    setNuwFileNum(taskId: string, nuwFileNum: number) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            nuwFileNum,
          },
        },
      }));
    },
    setType(taskId: string, type: string) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            type,
          },
        },
      }));
    },
    setDelayTime(taskId: string, delayTime: number) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            delayTime,
          },
        },
      }));
    },
    setElapsed(taskId: string, elapsed: number) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            elapsed,
          },
        },
      }));
    },
    getFormattedTaskTime(taskId: string) {
      const { tasks } = get();
      if (!taskId || !tasks[taskId]) return 'N/A';

      const task = tasks[taskId];
      let taskTime = task.taskTime;
      let elapsed = task.elapsed;
      let time = 0;
      // if task is running, compute current time
      if (taskTime !== 0) {
        const currentTime = Date.now();
        time = currentTime - taskTime + elapsed;
      } else {
        time = elapsed;
      }
      const hours = Math.floor(time / 3600000);
      const minutes = Math.floor((time % 3600000) / 60000);
      const seconds = Math.floor((time % 60000) / 1000);
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    },
    addTokens(taskId: string, tokens: number) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            tokens: state.tasks[taskId].tokens + tokens,
          },
        },
      }));
    },
    getTokens(taskId: string) {
      const { tasks } = get();
      return tasks[taskId]?.tokens ?? 0;
    },
    setSelectedFile(taskId: string, selectedFile: FileInfo | null) {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              selectedFile: selectedFile,
            },
          },
        };
      });
    },
    setSnapshots(taskId: string, snapshots: any[]) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            snapshots,
          },
        },
      }));
    },
    setSnapshotsTemp(taskId: string, snapshot: any) {
      set((state) => {
        const oldList = state.tasks[taskId]?.snapshotsTemp || [];
        if (oldList.find((item) => item.browser_url === snapshot.browser_url)) {
          return state;
        }
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              snapshotsTemp: [...state.tasks[taskId].snapshotsTemp, snapshot],
            },
          },
        };
      });
    },
    setPlanDirty(taskId: string, dirty: boolean) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            planDirty: dirty,
          },
        },
      }));
    },
    setAutoConfirmDeadline(taskId: string, deadline: number | null) {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              autoConfirmDeadline: deadline,
            },
          },
        };
      });
    },
    async savePlan(taskId: string) {
      const { tasks, setPlanDirty, setAutoConfirmDeadline } = get();
      const task = tasks[taskId];
      if (!task) return;
      try {
        await persistSubtaskEdits(task.taskInfo);
        setPlanDirty(taskId, false);
      } catch (err) {
        console.error('Failed to persist subtask edits:', err);
        return;
      }

      // After Save, restart the 30-second auto-confirm timer for predictable UX.
      const projectId = useProjectStore.getState().activeProjectId;
      const lastToSubTasks = task.messages.findLast(
        (m: Message) => m.step === AgentStep.TO_SUB_TASKS
      );
      if (
        !projectId ||
        !lastToSubTasks ||
        lastToSubTasks.isConfirm ||
        task.isTakeControl
      ) {
        return;
      }

      try {
        if (autoConfirmTimers[taskId]) {
          clearTimeout(autoConfirmTimers[taskId]);
          delete autoConfirmTimers[taskId];
        }
        setAutoConfirmDeadline(taskId, null);
      } catch (error) {
        console.warn('Error clearing auto-confirm timer in savePlan:', error);
      }

      setAutoConfirmDeadline(taskId, Date.now() + AUTO_CONFIRM_TIMEOUT_MS);
      autoConfirmTimers[taskId] = setTimeout(() => {
        try {
          const latestState = get();
          const latest = latestState.tasks[taskId];
          if (!latest) {
            delete autoConfirmTimers[taskId];
            return;
          }
          const message = latest.messages.findLast(
            (item: Message) => item.step === AgentStep.TO_SUB_TASKS
          );
          const isConfirm = message?.isConfirm || false;
          const isTakeControl = latest.isTakeControl;

          if (projectId && !isConfirm && !isTakeControl && !latest.planDirty) {
            latestState.handleConfirmTask(projectId, taskId);
          }
          latestState.setPlanDirty(taskId, false);
          latestState.setAutoConfirmDeadline(taskId, null);
          delete autoConfirmTimers[taskId];
        } catch (error) {
          console.error('Error in savePlan auto-confirm handler:', error);
          get().setAutoConfirmDeadline(taskId, null);
          delete autoConfirmTimers[taskId];
        }
      }, AUTO_CONFIRM_TIMEOUT_MS);
    },
    clearTasks: () => {
      const { create } = get();
      console.log('clearTasks');

      // Clean up all pending auto-confirm timers when clearing tasks
      try {
        Object.keys(autoConfirmTimers).forEach((taskId) => {
          try {
            if (autoConfirmTimers[taskId]) {
              clearTimeout(autoConfirmTimers[taskId]);
              delete autoConfirmTimers[taskId];
            }
          } catch (error) {
            console.warn(`Error clearing timer for task ${taskId}:`, error);
          }
        });
      } catch (error) {
        console.error('Error during timer cleanup in clearTasks:', error);
      }

      // Clean up all active SSE connections
      try {
        Object.keys(activeSSEControllers).forEach((taskId) => {
          try {
            if (activeSSEControllers[taskId]) {
              activeSSEControllers[taskId].controller.abort();
              delete activeSSEControllers[taskId];
            }
          } catch (error) {
            console.warn(
              `Error aborting SSE connection for task ${taskId}:`,
              error
            );
          }
        });
      } catch (error) {
        console.error('Error during SSE cleanup in clearTasks:', error);
      }

      const restartPromise = getHostIpcRenderer()?.invoke?.('restart-backend');
      if (restartPromise) {
        restartPromise
          .then((res: unknown) => {
            console.log('restart-backend', res);
          })
          .catch((error: unknown) => {
            console.error('Error in clearTasks cleanup:', error);
          });
      }

      // Immediately create new task to maintain UI responsiveness
      const newTaskId = create();
      set((state) => ({
        ...state,
        tasks: {
          [newTaskId]: {
            ...state.tasks[newTaskId],
          },
        },
      }));
    },
    setIsContextExceeded: (taskId, isContextExceeded) => {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            isContextExceeded: isContextExceeded,
          },
        },
      }));
    },
    setNextTaskId: (taskId) => {
      set((state) => ({
        ...state,
        nextTaskId: taskId,
      }));
    },
    setStreamingDecomposeText: (taskId, text) => {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              streamingDecomposeText: text,
            },
          },
        };
      });
    },
    clearStreamingDecomposeText: (taskId) => {
      // Clear buffer and any pending timer
      delete streamingDecomposeTextBuffer[taskId];
      if (streamingDecomposeTextTimers[taskId]) {
        clearTimeout(streamingDecomposeTextTimers[taskId]);
        delete streamingDecomposeTextTimers[taskId];
      }

      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              streamingDecomposeText: '',
            },
          },
        };
      });
    },
    setExecutionId: (taskId, executionId) => {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              executionId,
            },
          },
        };
      });
    },
    setTaskSource: (taskId, source) => {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              source,
            },
          },
        };
      });
    },
    setNextExecutionId: (taskId, nextExecutionId) => {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              nextExecutionId,
            },
          },
        };
      });
    },
  }));

const filterMessage = (message: AgentMessage) => {
  if (message.data.toolkit_name?.includes('Search ')) {
    message.data.toolkit_name = 'Search Toolkit';
  }

  message.data.message = normalizeToolkitMessage(message.data.message);

  if (message.data.toolkit_name === 'Note Taking Toolkit') {
    message.data.message = message.data.message
      .replace(/content='/g, '')
      .replace(/', update=False/g, '')
      .replace(/', update=True/g, '');
  }
  if (message.data.method_name === 'scrape') {
    message.data.message = message.data.message
      .replace(/url='/g, '')
      .slice(0, -1);
  }
  return message;
};

export const useChatStore = chatStore;

/** Create a new chat store instance. Use this in non-React code (e.g. projectStore). */
export const createChatStoreInstance = chatStore;

export const getToolStore = () => chatStore().getState();

/** Returns true if any task has an active SSE connection. */
export function hasActiveSSEConnection(taskIds: string[]): boolean {
  return taskIds.some((taskId) => !!activeSSEControllers[taskId]);
}

/**
 * Returns true when any legacy `/chat` task still owns a live renderer SSE.
 * This is a compatibility signal only; canonical Run state comes from the
 * durable `/runs` registry.
 */
export function hasAnyActiveLegacySSEConnection(): boolean {
  return Object.values(activeSSEControllers).some(
    (connection) => connection.live
  );
}

/** Close SSE for given tasks (e.g. after completion, so triggers can start fresh). */
export function closeSSEConnectionsForTasks(taskIds: string[]): void {
  for (const taskId of taskIds) {
    if (activeSSEControllers[taskId]) {
      console.log(
        '[closeSSEConnectionsForTasks] Closing SSE for task:',
        taskId
      );
      try {
        activeSSEControllers[taskId].controller.abort();
      } catch (_e) {
        // Ignore if already aborted
      }
      delete activeSSEControllers[taskId];
    }
  }
}
