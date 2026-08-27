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

import { proxyFetchGet } from '@/api/http';
import { generateUniqueId } from '@/lib';
import {
  deleteCachedProject,
  getCachedProject,
  putCachedProject,
  type CachedTask,
} from '@/lib/projectCache';
import type { SessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { getSessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { isPlaceholderProjectName } from '@/lib/spaceLabel';
import { resolveHistoricalRunElapsedMs } from '@/lib/taskDuration';
import { fetchProjectRuns } from '@/service/projectRunsApi';
import type { ServerProject } from '@/service/spaceApi';
import { proxyUpdateSpaceProject } from '@/service/spaceApi';
import {
  ChatTaskStatus,
  normalizeThinkingEffort,
  TaskStatus,
  ThinkingEffort,
  type TaskStatusType,
  type ThinkingEffortType,
} from '@/types/constants';
import { create } from 'zustand';
import { getAuthStore } from './authStore';
import {
  createChatStoreInstance,
  hasActiveSSEConnection,
  VanillaChatStore,
  type DurableRunDisplayStatus,
} from './chatStore';
import { usePageTabStore } from './pageTabStore';
import {
  releaseProjectEventStore,
  resetProjectEventStore,
} from './projectEventStore';
import {
  projectMetaFromServer,
  useSpaceStore,
  type SpaceProjectMeta,
} from './spaceStore';

/**
 * After a history project finishes replaying, the per-subtask `status` may be
 * incomplete: backend's recorded SSE stream only carries `task_state` for
 * leaf subtasks, so any top-level subtask that was further decomposed never
 * gets its TaskStatus.COMPLETED set on replay (it stays at the EMPTY seed
 * from the TO_SUB_TASKS handler). This polish pass uses the authoritative
 * `chat_history.status` (set via direct PUT, not through the unreliable
 * step-sync path) to decide whether the project as a whole completed; if so,
 * any leftover non-terminal subtask is promoted to COMPLETED so the badge
 * renders Done instead of Pending.
 *
 * Important: clicking the Stop button hits backend's Action.skip_task, which
 * ALSO yields an `end` SSE event (with summary "<summary>Task stopped</…>")
 * and triggers the same status=2 PUT. So `status === done` alone can't
 * distinguish natural completion from a user-initiated stop. The skip_task
 * path embeds a fixed sentinel in the END payload, which the frontend writes
 * verbatim into `chat_history.summary`; we use that prefix to opt those tasks
 * out of the polish.
 */
const HISTORY_STATUS_DONE = 2;
const STOPPED_BY_USER_SUMMARY_PREFIX = '<summary>Task stopped</summary>';
/**
 * Local RunJournal data enriches a cloud history replay, but it must never be
 * a first-paint dependency. During an active Run SQLite can be briefly busy;
 * after this budget we continue with the already available cloud/IDB history.
 */
const LOCAL_RUN_ENRICHMENT_BUDGET_MS = 1_200;
const DURABLE_RUN_DISPLAY_STATUSES = new Set<DurableRunDisplayStatus>([
  'pending',
  'running',
  'waiting_for_user',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'stopped',
]);
const TERMINAL_DURABLE_RUN_DISPLAY_STATUSES = new Set<DurableRunDisplayStatus>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'stopped',
]);
const TERMINAL_SUBTASK_STATUSES = new Set<TaskStatusType>([
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.SKIPPED,
]);

const promoteSubtaskStatus = (
  status: TaskStatusType | undefined
): TaskStatusType =>
  status && TERMINAL_SUBTASK_STATUSES.has(status)
    ? status
    : TaskStatus.COMPLETED;

const timestampFromServer = (value?: string | null, fallback = Date.now()) => {
  if (!value) return fallback;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
};

const durableRunDisplayStatus = (
  value: unknown
): DurableRunDisplayStatus | undefined =>
  typeof value === 'string' &&
  DURABLE_RUN_DISPLAY_STATUSES.has(value as DurableRunDisplayStatus)
    ? (value as DurableRunDisplayStatus)
    : undefined;

const cachedTaskProjectionIsIncomplete = (
  taskState: unknown,
  localRunStatus?: DurableRunDisplayStatus
): boolean => {
  if (!taskState || typeof taskState !== 'object' || Array.isArray(taskState)) {
    return true;
  }
  const messages = (taskState as Record<string, unknown>).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return true;
  }

  // A terminal canonical Run must have a visible agent result or error. An
  // earlier renderer failure could leave an IDB snapshot containing only the
  // seeded user prompt; its freshness anchors still matched SQLite, so it
  // suppressed authoritative replay forever. Treat that shape as a partial
  // projection for both successful and failed Runs.
  if (localRunStatus === 'completed' || localRunStatus === 'failed') {
    return !messages.some(
      (message) =>
        message !== null &&
        typeof message === 'object' &&
        (message as Record<string, unknown>).role === 'agent' &&
        typeof (message as Record<string, unknown>).content === 'string' &&
        Boolean(((message as Record<string, unknown>).content as string).trim())
    );
  }
  return false;
};

const polishCompletedHistoryTask = (
  chatStore: VanillaChatStore,
  taskId: string
) => {
  const state = chatStore.getState();
  const task = state.tasks[taskId];
  if (!task) return;

  state.setTaskInfo(
    taskId,
    task.taskInfo.map((t) => ({ ...t, status: promoteSubtaskStatus(t.status) }))
  );
  state.setTaskRunning(
    taskId,
    task.taskRunning.map((t) => ({
      ...t,
      status: promoteSubtaskStatus(t.status),
    }))
  );
  state.setTaskAssigning(
    taskId,
    task.taskAssigning.map((agent) => ({
      ...agent,
      tasks: agent.tasks.map((t) => ({
        ...t,
        status: promoteSubtaskStatus(t.status),
      })),
    }))
  );
};

export enum ProjectType {
  NORMAL = 'normal',
  REPLAY = 'replay',
}

export type ProjectMode = 'single-agent' | 'workforce';
export type ProjectWorkdirMode =
  'worktree' | 'copy' | 'direct-write' | 'artifact-only';

interface TaskQueue {
  task_id: string;
  run_id?: string;
  content: string;
  timestamp: number;
  attaches: File[];
  executionId?: string;
  triggerTaskId?: string;
  triggerId?: number;
  triggerName?: string;
  processing?: boolean;
  sendNow?: boolean;
  source?: 'local' | 'remote_control' | 'scheduled';
  reviewHandoffIds?: string[];
}

/**
 * Model selection captured for a Project so follow-up runs reuse the same
 * model instead of the global default. Field names mirror the provider /
 * history payloads (`model_platform`, `model_type`) and authStore state
 * (`modelType`, `cloud_model_type`, `codex_model_type`).
 */
interface ProjectModelSelection {
  modelType: 'cloud' | 'local' | 'custom' | 'codex_subscription';
  cloud_model_type?: string;
  codex_model_type?: string;
  provider_id?: number;
  model_platform?: string;
  model_type?: string;
}

interface ProjectMetadata {
  tags?: string[];
  priority?: 'low' | 'medium' | 'high';
  status?: 'active' | 'completed' | 'archived';
  achievedAt?: number | null;
  legacyRootPath?: string | null;
  baseSnapshotId?: string | null;
  legacyAlias?: string;
  workdirProbe?: {
    probedAt: number;
    preferredWorkdirMode?: ProjectWorkdirMode;
    actualWorkdirMode?: ProjectWorkdirMode;
    reason?: string;
  };
  /**Save history id for replay reuse purposes.
   * TODO(history): Remove historyId handling to support per projectId
   * instead in history api
   */
  historyId?: string;
  historyDisplayName?: string;
  /** Per-Project model pin; reused by startTask for follow-up runs. */
  modelSelection?: ProjectModelSelection;
  /** Requested effort for new Runs; null clears a persisted override. */
  thinkingEffort?: ThinkingEffortType | null;
  serverSynced?: boolean;
  autoCreatedPlaceholder?: boolean;
  remoteHistoryHydrationPending?: boolean;
}

interface Project {
  id: string;
  spaceId?: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  mode?: ProjectMode | null;
  workdirMode?: ProjectWorkdirMode | null;
  // PR-X4 bridge: a Project is the durable session and new Runs append to the
  // primary chatStore. The map stays for old persisted Projects until the
  // runtime store is fully migrated.
  chatStores: { [chatId: string]: VanillaChatStore };
  chatStoreTimestamps: { [chatId: string]: number };
  activeChatId: string | null;
  queuedMessages: Array<TaskQueue>; // Project-level queued messages
  metadata?: ProjectMetadata;
}

const statusFromProject = (project: Project): 'active' | 'archived' =>
  project.metadata?.status === 'archived' ? 'archived' : 'active';

const projectToSpaceProjectMeta = (
  project: Project
): SpaceProjectMeta | null => {
  if (!project.spaceId) return null;
  return {
    id: project.id,
    spaceId: project.spaceId,
    name: project.name,
    description: project.description,
    mode: project.mode ?? null,
    workdirMode: project.workdirMode ?? null,
    status: statusFromProject(project),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    metadata: project.metadata,
  };
};

const projectShellFromMeta = (meta: SpaceProjectMeta): Project => ({
  id: meta.id,
  spaceId: meta.spaceId,
  name: meta.name,
  description: meta.description,
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt,
  mode: meta.mode ?? null,
  workdirMode: meta.workdirMode ?? null,
  chatStores: {},
  chatStoreTimestamps: {},
  activeChatId: null,
  queuedMessages: [],
  metadata: {
    ...meta.metadata,
    status: meta.metadata?.status ?? meta.status,
    serverSynced: true,
  },
});

const mergeProjectMeta = (
  existing: Project | undefined,
  meta: SpaceProjectMeta
): Project => {
  const shell = projectShellFromMeta(meta);
  if (!existing) return shell;
  const shouldKeepExistingName =
    isPlaceholderProjectName(meta.name, meta.id) &&
    !isPlaceholderProjectName(existing.name, existing.id);
  return {
    ...existing,
    spaceId: meta.spaceId,
    name: shouldKeepExistingName ? existing.name : meta.name || existing.name,
    description: meta.description ?? existing.description,
    mode: meta.mode ?? existing.mode ?? null,
    workdirMode: meta.workdirMode ?? existing.workdirMode ?? null,
    metadata: {
      ...existing.metadata,
      ...meta.metadata,
      status: meta.metadata?.status ?? meta.status,
      serverSynced: true,
    },
    updatedAt: meta.updatedAt,
  };
};

const getPrimaryChatId = (project: Project): string | null => {
  if (project.activeChatId && project.chatStores[project.activeChatId]) {
    return project.activeChatId;
  }

  const chatIds = Object.keys(project.chatStores);
  if (chatIds.length === 0) return null;

  return chatIds.sort(
    (a, b) =>
      (project.chatStoreTimestamps?.[a] ?? project.createdAt) -
      (project.chatStoreTimestamps?.[b] ?? project.createdAt)
  )[0];
};

const upsertSpaceProjectMetaFromProject = (project: Project) => {
  const meta = projectToSpaceProjectMeta(project);
  if (meta) {
    useSpaceStore.getState().upsertProjectMetas([meta]);
  }
};

interface ThinkingEffortPersistenceState {
  confirmedEffort: ThinkingEffortType | null;
  confirmedServerUpdatedAt?: number;
  optimisticEffort: ThinkingEffortType | null;
  latestRevision: number;
  pendingCount: number;
  removed: boolean;
  tail: Promise<void>;
}

/** Serializes per-Project effort writes so older PATCHes cannot win a race. */
const thinkingEffortPersistenceByProject = new Map<
  string,
  ThinkingEffortPersistenceState
>();

interface CreateProjectOptions {
  spaceId?: string;
  mode?: ProjectMode | null;
  workdirMode?: ProjectWorkdirMode | null;
  metadata?: Partial<ProjectMetadata>;
  createdAt?: number;
  updatedAt?: number;
}

interface LoadProjectFromHistoryOptions {
  /**
   * Abort before rebuilding runtime state when an async navigation request is
   * no longer the active Project selection. Sidebar history discovery can
   * resolve out of order, so an older request must not steal focus back from
   * the Project the user selected most recently.
   */
  requireActiveSelection?: boolean;
}

interface ProjectStore {
  activeProjectId: string | null;
  projects: { [projectId: string]: Project };
  /** Preloaded sidebar icon state from history (stable while hydrating). */
  navLeadByProjectId: Record<string, SessionNavLeadPresentation>;
  /** Projects currently replaying history at delay 0 — sidebar uses cached lead. */
  historyLoadingProjectIds: Record<string, true>;
  /**
   * Projects whose latest history rebuild did not finish completely. A replay
   * creates its Project shell before awaiting SQLite/cache reads; if the user
   * switches Projects during that await, the shell can legitimately remain
   * but must never be mistaken for loaded history.
   */
  historyLoadIncompleteProjectIds: Record<string, true>;
  /**
   * Optional thinking-effort override selected on Workspace / New session
   * before a Project exists. Undefined preserves the configured Bundle
   * default when the first task starts.
   */
  composerThinkingEffort: ThinkingEffortType | undefined;
  /**
   * Projects whose IDB cache was just detected stale during this session.
   * The in-memory hydrated state keeps rendering (so the current view is
   * not interrupted), but every active-project transition evicts the
   * entry so the next selection falls through to a fresh history load.
   */
  staleProjectIds: Set<string>;
  /**
   * Drop a project's runtime state (chatStores + nav lead) **without**
   * removing its SpaceProjectMeta. Used by the stale-cache eviction path:
   * we want the project to keep showing up in the sidebar and Spaces Hub,
   * just with no in-memory state, so the next selection re-runs the
   * history load. Distinct from `removeProject`, which also tears down
   * the Space metadata and is intended for genuine project deletion.
   */
  _evictProjectRuntime: (projectId: string) => void;
  /**
   * If `activeProjectId` is currently in `staleProjectIds` and we are
   * transitioning to a different project (or to null), evict the runtime
   * state of the outgoing one. Call this immediately before any direct
   * write to `activeProjectId` so all transition paths (`setActiveProject`,
   * `createProject`, `replayProject`, `loadProjectFromHistory`) honour
   * the stale-eviction contract.
   */
  _evictStaleOnTransition: (nextProjectId: string | null) => void;

  // Project management
  /**
   *
   * @param name
   * @param description
   * @param projectId
   * @param type
   * @param historyId Mainly passed from @function replayProject
   * @returns projectId
   */
  createProject: (
    name: string,
    description?: string,
    projectId?: string,
    type?: ProjectType,
    historyId?: string,
    setActive?: boolean,
    options?: CreateProjectOptions
  ) => string;
  setActiveProject: (projectId: string | null) => void;
  setActiveSpaceAndProject: (spaceId: string, projectId: string) => void;
  setProjectSpace: (projectId: string, spaceId: string) => void;
  upsertProjectsFromServer: (serverProjects: ServerProject[]) => void;
  cleanupAutoCreatedEmptyProjects: () => void;
  removeProject: (
    projectId: string,
    options?: { preserveEventStore?: boolean }
  ) => void;
  updateProject: (
    projectId: string,
    updates: Partial<Omit<Project, 'id' | 'createdAt'>>
  ) => void;
  replayProject: (
    taskIds: string[],
    question?: string,
    projectId?: string,
    historyId?: string
  ) => string;
  /**
   * Load project from history. Tries an IDB-backed cache first (skip-replay
   * fast path); falls back to SSE replay on miss. Resolves when loading
   * completes. `serverUpdatedAt` is the project's last-activity timestamp
   * (ms) from the history API. Local RunJournal projects additionally compare
   * SQLite's max Run.updated_at before hydration, so IDB can accelerate UI
   * reconstruction without becoming a source of truth.
   */
  loadProjectFromHistory: (
    taskIds: string[],
    question: string,
    projectId: string,
    historyId?: string,
    projectName?: string,
    spaceId?: string,
    taskQuestionsById?: Record<string, string>,
    serverUpdatedAt?: number | null,
    options?: LoadProjectFromHistoryOptions
  ) => Promise<string>;
  mergeProjectHistory: (
    projectId: string,
    tasks: Array<{ task_id?: string | null; question?: string | null }>,
    fallbackQuestion?: string
  ) => Promise<void>;
  setProjectNavLead: (
    projectId: string,
    lead: SessionNavLeadPresentation
  ) => void;
  setProjectNavLeads: (
    leads: Record<string, SessionNavLeadPresentation>
  ) => void;
  setHistoryLoadingProject: (projectId: string, loading: boolean) => void;
  setHistoryLoadIncomplete: (projectId: string, incomplete: boolean) => void;

  // Project-level queued messages management
  addQueuedMessage: (
    projectId: string,
    content: string,
    attaches: File[],
    task_id?: string,
    executionId?: string,
    triggerTaskId?: string,
    triggerId?: number,
    triggerName?: string,
    source?: 'local' | 'remote_control' | 'scheduled'
  ) => string | null;
  removeQueuedMessage: (projectId: string, taskId: string) => TaskQueue;
  restoreQueuedMessage: (projectId: string, messageData: TaskQueue) => void;
  clearQueuedMessages: (projectId: string) => void;
  markQueuedMessageAsProcessing: (projectId: string, taskId: string) => void;
  setQueuedMessageProcessing: (
    projectId: string,
    taskId: string,
    processing: boolean
  ) => void;
  prioritizeQueuedMessage: (projectId: string, taskId: string) => void;

  // Chat store state management
  createChatStore: (projectId: string, chatName?: string) => string | null;
  appendInitChatStore: (
    projectId: string,
    customTaskId?: string,
    chatName?: string
  ) => { taskId: string; chatStore: VanillaChatStore } | null;
  setActiveChatStore: (projectId: string, chatId: string) => void;
  removeChatStore: (projectId: string, chatId: string) => void;
  saveChatStore: (
    projectId: string,
    chatId: string,
    state: VanillaChatStore
  ) => void;
  getChatStore: (
    projectId?: string,
    chatId?: string
  ) => VanillaChatStore | null;
  /**
   * Pure read helper for render paths. It never creates a Project or chat store.
   * Use this when missing runtime state should render as empty/loading.
   */
  peekActiveChatStore: (projectId?: string) => VanillaChatStore | null;
  /**
   * Pure read helper for the active Project. Project/chat creation must happen
   * through explicit user actions or `appendInitChatStore`, not from render.
   */
  getActiveChatStore: (projectId?: string) => VanillaChatStore | null;
  getAllChatStores: (
    projectId: string
  ) => Array<{ chatId: string; chatStore: VanillaChatStore }>;

  // Utility methods
  getAllProjects: (spaceId?: string) => Project[];
  getProjectById: (projectId: string) => Project | null;
  getProjectTotalTokens: (projectId: string) => number;
  isEmptyProject: (project: Project) => boolean;

  //History ID
  setHistoryId: (projectId: string, historyId: string) => void;
  getHistoryId: (projectId: string | null) => string | null;

  // Per-Project model selection
  setProjectModel: (
    projectId: string,
    modelSelection: ProjectModelSelection
  ) => void;
  getProjectModel: (projectId: string | null) => ProjectModelSelection | null;
  setProjectThinkingEffort: (
    projectId: string,
    effort: ThinkingEffortType | undefined
  ) => void;
  getProjectThinkingEffort: (projectId: string | null) => ThinkingEffortType;
  getProjectThinkingEffortOverride: (
    projectId: string | null
  ) => ThinkingEffortType | undefined;
  setComposerThinkingEffort: (effort: ThinkingEffortType | undefined) => void;
  getComposerThinkingEffort: () => ThinkingEffortType | undefined;
}

// Helper function to check if a project is empty/unused
const isEmptyProject = (project: Project): boolean => {
  try {
    // Check if project has only one chat store
    const chatStoreIds = Object.keys(project.chatStores);
    if (chatStoreIds.length !== 1) {
      return false;
    }

    const chatStore = project.chatStores[chatStoreIds[0]];
    if (!chatStore || !chatStore.getState) {
      return false;
    }

    const chatState = chatStore.getState();
    const taskIds = Object.keys(chatState.tasks);

    // Check if chat store has only one task
    if (taskIds.length !== 1) {
      return false;
    }

    const task = chatState.tasks[taskIds[0]];
    if (!task) {
      return false;
    }

    // Check if project has any queued messages
    if (project.queuedMessages && project.queuedMessages.length > 0) {
      return false;
    }

    // Check if task is in initial/empty state
    const isEmpty =
      Array.isArray(task.messages) &&
      task.messages.length === 0 &&
      task.summaryTask === '' &&
      task.progressValue === 0 &&
      task.isPending === false &&
      task.status === ChatTaskStatus.PENDING &&
      task.taskTime === 0 &&
      task.tokens === 0 &&
      task.elapsed === 0 &&
      task.hasWaitComfirm === false;

    return isEmpty;
  } catch (error) {
    console.warn('[store] Error checking if project is empty:', error);
    return false;
  }
};

const normalizedText = (value?: string | null) =>
  (value ?? '').trim().toLowerCase();

const isAutoCreatedEmptyProject = (project: Project): boolean =>
  project.metadata?.serverSynced !== true &&
  (project.metadata?.autoCreatedPlaceholder === true ||
    (normalizedText(project.name) === 'new project' &&
      normalizedText(project.description) === 'auto-created project')) &&
  isEmptyProject(project);

const projectStore = create<ProjectStore>()((set, get) => ({
  activeProjectId: null,
  projects: {},
  navLeadByProjectId: {},
  historyLoadingProjectIds: {},
  historyLoadIncompleteProjectIds: {},
  staleProjectIds: new Set<string>(),
  composerThinkingEffort: undefined,

  setProjectNavLead: (projectId, lead) =>
    set((state) => ({
      navLeadByProjectId: {
        ...state.navLeadByProjectId,
        [projectId]: lead,
      },
    })),

  setProjectNavLeads: (leads) =>
    set((state) => {
      const next = { ...state.navLeadByProjectId };
      for (const [projectId, lead] of Object.entries(leads)) {
        // Don't clobber a live lead: if the project already has an active
        // chat store the subscription registry is maintaining a real-time
        // lead (running spinner, etc.) that the history summary cannot know
        // about.
        const project = state.projects[projectId];
        const hasLiveStore = Boolean(
          project &&
          (project.activeChatId
            ? project.chatStores[project.activeChatId]
            : Object.keys(project.chatStores ?? {}).length > 0)
        );
        if (!hasLiveStore) {
          next[projectId] = lead;
        }
      }
      return { navLeadByProjectId: next };
    }),

  setHistoryLoadingProject: (projectId, loading) =>
    set((state) => {
      if (loading) {
        if (state.historyLoadingProjectIds[projectId]) return state;
        return {
          historyLoadingProjectIds: {
            ...state.historyLoadingProjectIds,
            [projectId]: true,
          },
        };
      }
      if (!state.historyLoadingProjectIds[projectId]) return state;
      const next = { ...state.historyLoadingProjectIds };
      delete next[projectId];
      return { historyLoadingProjectIds: next };
    }),

  setHistoryLoadIncomplete: (projectId, incomplete) =>
    set((state) => {
      if (incomplete) {
        if (state.historyLoadIncompleteProjectIds[projectId]) return state;
        return {
          historyLoadIncompleteProjectIds: {
            ...state.historyLoadIncompleteProjectIds,
            [projectId]: true,
          },
        };
      }
      if (!state.historyLoadIncompleteProjectIds[projectId]) return state;
      const next = { ...state.historyLoadIncompleteProjectIds };
      delete next[projectId];
      return { historyLoadIncompleteProjectIds: next };
    }),

  createProject: (
    name: string,
    description?: string,
    projectId?: string,
    type?: ProjectType,
    historyId?: string,
    setActive: boolean = true,
    options?: CreateProjectOptions
  ) => {
    const resolvedSpaceId =
      options?.spaceId ?? useSpaceStore.getState().activeSpaceId ?? undefined;

    // Project is the session container in the Space IA. Explicit "New Project"
    // actions must always create a fresh container instead of silently focusing
    // an existing empty one.
    const targetProjectId = projectId ?? generateUniqueId();
    const now = Date.now();
    const createdAt = options?.createdAt ?? now;
    const updatedAt = options?.updatedAt ?? now;

    // Create initial chat store for the project
    const initialChatId = generateUniqueId();
    const initialChatStore = createChatStoreInstance();

    // Initialize the chat store with a task using the create() function
    if (type !== ProjectType.REPLAY) initialChatStore.getState().create();

    // Create new project with default chat store
    const newProject: Project = {
      id: targetProjectId,
      spaceId: resolvedSpaceId,
      name,
      description,
      createdAt,
      updatedAt,
      mode: options?.mode ?? null,
      workdirMode: options?.workdirMode ?? null,
      chatStores: {
        [initialChatId]: initialChatStore,
      },
      chatStoreTimestamps: {
        [initialChatId]: now,
      },
      activeChatId: initialChatId,
      queuedMessages: [], // Initialize empty queued messages array
      metadata: {
        status: 'active',
        historyId: historyId,
        tags: type === ProjectType.REPLAY ? ['replay'] : [],
        ...(description === 'Auto-created project'
          ? { autoCreatedPlaceholder: true }
          : {}),
        ...options?.metadata,
      },
    };

    const effortPersistence =
      thinkingEffortPersistenceByProject.get(targetProjectId);
    if (effortPersistence?.removed) {
      // History reloads remove and recreate the runtime with the same id. Keep
      // the existing write queue alive, including its last server-confirmed
      // rollback value, and seed the new shell with the pending local choice.
      effortPersistence.removed = false;
      newProject.metadata = {
        ...newProject.metadata,
        thinkingEffort: effortPersistence.optimisticEffort,
      };
    }

    console.log('[store] Creating a new project');
    // Evict stale runtime state of the outgoing active project before we
    // overwrite activeProjectId — `setActiveProject` is bypassed here so
    // we must invoke the eviction contract ourselves.
    if (setActive) {
      get()._evictStaleOnTransition(targetProjectId);
    }
    set((state) => {
      const nextIncompleteProjectIds = {
        ...state.historyLoadIncompleteProjectIds,
      };
      delete nextIncompleteProjectIds[targetProjectId];
      return {
        projects: {
          ...state.projects,
          [targetProjectId]: newProject,
        },
        historyLoadIncompleteProjectIds: nextIncompleteProjectIds,
        ...(setActive ? { activeProjectId: targetProjectId } : {}),
      };
    });
    upsertSpaceProjectMetaFromProject(newProject);

    return targetProjectId;
  },

  setActiveProject: (projectId: string | null) => {
    // Stale-cache eviction: if the outgoing active project was a stale-
    // hydrated entry, drop its runtime state so the next selection forces
    // a fresh history load. Keeps the Space metadata intact so the
    // project still shows up in the sidebar.
    get()._evictStaleOnTransition(projectId);

    if (!projectId) {
      set({ activeProjectId: null });
      return;
    }

    const { projects } = get();
    const meta = useSpaceStore.getState().getProjectMeta(projectId);

    if (!projects[projectId]) {
      if (!meta) {
        console.warn(`Project ${projectId} not found`);
        return;
      }
      set((state) => ({
        projects: {
          ...state.projects,
          [projectId]: projectShellFromMeta(meta),
        },
      }));
    } else if (meta) {
      set((state) => ({
        projects: {
          ...state.projects,
          [projectId]: mergeProjectMeta(state.projects[projectId], meta),
        },
      }));
    }
    const project = get().projects[projectId];
    const projectSpaceId = project?.spaceId;
    if (projectSpaceId) {
      const spaceStore = useSpaceStore.getState();
      if (spaceStore.getSpaceById(projectSpaceId)) {
        spaceStore.setActiveSpace(projectSpaceId);
        spaceStore.setLastVisitedProject(projectSpaceId, projectId);
      }
    }

    set({ activeProjectId: projectId });

    // Update project's updatedAt
    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          updatedAt: Date.now(),
        },
      },
    }));
  },

  setActiveSpaceAndProject: (spaceId: string, projectId: string) => {
    const { projects } = get();
    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }
    useSpaceStore.getState().setActiveSpace(spaceId);
    get().setActiveProject(projectId);
  },

  setProjectSpace: (projectId: string, spaceId: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          spaceId,
          updatedAt: Date.now(),
        },
      },
    }));
    const updatedProject = get().projects[projectId];
    if (updatedProject) {
      upsertSpaceProjectMetaFromProject(updatedProject);
    }
  },

  upsertProjectsFromServer: (serverProjects) => {
    if (serverProjects.length === 0) return;
    const protectedEffortProjectIds = new Set<string>();
    const reconciledServerProjects = serverProjects.map((serverProject) => {
      const persistence = thinkingEffortPersistenceByProject.get(
        serverProject.id
      );
      if (!persistence) return serverProject;

      // A server refresh can restore a runtime removed during history
      // transitions. Resume its existing queue without replacing the last
      // confirmed rollback value with optimistic shell metadata.
      persistence.removed = false;

      const rawServerEffort = serverProject.metadata?.thinkingEffort;
      const serverEffort =
        rawServerEffort == null
          ? null
          : normalizeThinkingEffort(rawServerEffort);
      const parsedServerUpdatedAt = serverProject.updated_at
        ? timestampFromServer(serverProject.updated_at, Number.NaN)
        : undefined;
      const serverUpdatedAt = Number.isFinite(parsedServerUpdatedAt)
        ? parsedServerUpdatedAt
        : undefined;
      const hydrationIsStale =
        persistence.confirmedServerUpdatedAt !== undefined &&
        (serverUpdatedAt === undefined ||
          serverUpdatedAt < persistence.confirmedServerUpdatedAt);

      if (!hydrationIsStale) {
        persistence.confirmedEffort = serverEffort;
        if (serverUpdatedAt !== undefined) {
          persistence.confirmedServerUpdatedAt = serverUpdatedAt;
        }
      }

      if (persistence.pendingCount === 0 && !hydrationIsStale) {
        persistence.optimisticEffort = serverEffort;
        thinkingEffortPersistenceByProject.delete(serverProject.id);
        return serverProject;
      }

      // Preserve the latest local choice while its PATCH is pending, and
      // reject hydration snapshots older than an acknowledged PATCH.
      protectedEffortProjectIds.add(serverProject.id);
      const metadata = {
        ...(serverProject.metadata ?? {}),
        thinkingEffort: persistence.optimisticEffort,
      };
      return { ...serverProject, metadata };
    });
    useSpaceStore
      .getState()
      .upsertProjectMetas(reconciledServerProjects.map(projectMetaFromServer));

    set((state) => {
      const nextProjects = { ...state.projects };

      for (const serverProject of reconciledServerProjects) {
        const existing = nextProjects[serverProject.id];
        const createdAt = timestampFromServer(serverProject.created_at);
        const updatedAt = timestampFromServer(
          serverProject.updated_at,
          existing?.updatedAt ?? Date.now()
        );
        const serverMetadata = (serverProject.metadata ??
          {}) as Partial<ProjectMetadata>;

        if (existing) {
          const shouldKeepExistingName =
            isPlaceholderProjectName(serverProject.name, serverProject.id) &&
            !isPlaceholderProjectName(existing.name, existing.id);
          nextProjects[serverProject.id] = {
            ...existing,
            name: shouldKeepExistingName
              ? existing.name
              : serverProject.name || existing.name,
            description: serverProject.description ?? existing.description,
            spaceId: serverProject.space_id,
            mode: serverProject.mode ?? existing.mode ?? null,
            workdirMode:
              serverProject.workdir_mode ?? existing.workdirMode ?? null,
            metadata: {
              ...existing.metadata,
              ...serverMetadata,
              status: serverProject.status,
              serverSynced: true,
            },
            updatedAt,
          };
          continue;
        }

        nextProjects[serverProject.id] = {
          id: serverProject.id,
          spaceId: serverProject.space_id,
          name: serverProject.name || 'Project',
          description: serverProject.description ?? undefined,
          createdAt,
          updatedAt,
          mode: serverProject.mode ?? null,
          workdirMode: serverProject.workdir_mode ?? null,
          chatStores: {},
          chatStoreTimestamps: {},
          activeChatId: null,
          queuedMessages: [],
          metadata: {
            ...serverMetadata,
            status: serverProject.status,
            serverSynced: true,
          },
        };
      }

      return {
        projects: nextProjects,
      };
    });

    for (const projectId of protectedEffortProjectIds) {
      const project = get().projects[projectId];
      if (project) {
        upsertSpaceProjectMetaFromProject(project);
      }
    }
  },

  cleanupAutoCreatedEmptyProjects: () => {
    const { projects, activeProjectId } = get();
    const projectIdsToRemove = Object.values(projects)
      .filter(isAutoCreatedEmptyProject)
      .map((project) => project.id);

    if (projectIdsToRemove.length === 0) return;

    const removedIds = new Set(projectIdsToRemove);
    const nextProjects = { ...projects };
    for (const projectId of projectIdsToRemove) {
      delete nextProjects[projectId];
      usePageTabStore.getState().removeSessionPreviewProject(projectId);
      useSpaceStore.getState().removeProjectMeta(projectId);
    }

    set((state) => {
      // Drop any leftover stale flags for ids that just disappeared.
      // Auto-created blank projects don't normally end up in
      // staleProjectIds, but staying defensive keeps the lifecycle rule
      // ("permanent runtime removal clears the stale flag") consistent.
      let nextStale = state.staleProjectIds;
      for (const projectId of removedIds) {
        if (nextStale.has(projectId)) {
          if (nextStale === state.staleProjectIds) {
            nextStale = new Set(nextStale);
          }
          nextStale.delete(projectId);
        }
      }
      return {
        projects: nextProjects,
        activeProjectId:
          activeProjectId && removedIds.has(activeProjectId)
            ? null
            : activeProjectId,
        staleProjectIds: nextStale,
      };
    });

    // Publish Project removal before disposing its event-store subscribers so
    // mounted consumers are already scheduled to unmount from this runtime.
    for (const projectId of projectIdsToRemove) {
      releaseProjectEventStore(projectId);
    }

    console.warn(
      `[ProjectStore] Removed ${projectIdsToRemove.length} auto-created empty Project(s).`
    );
  },

  createChatStore: (projectId: string, _chatName?: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return null;
    }

    const existingPrimaryChatId = getPrimaryChatId(projects[projectId]);
    if (existingPrimaryChatId) {
      set((state) => ({
        projects: {
          ...state.projects,
          [projectId]: {
            ...state.projects[projectId],
            activeChatId: existingPrimaryChatId,
            updatedAt: Date.now(),
          },
        },
      }));
      return existingPrimaryChatId;
    }

    const chatId = generateUniqueId();
    const newChatStore = createChatStoreInstance();
    const now = Date.now();

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          chatStores: {
            ...state.projects[projectId].chatStores,
            [chatId]: newChatStore,
          },
          chatStoreTimestamps: {
            ...state.projects[projectId].chatStoreTimestamps,
            [chatId]: now,
          },
          activeChatId: chatId,
          updatedAt: now,
        },
      },
    }));

    return chatId;
  },

  /**
   *
   * @param projectId project id to append a new chatStore to
   * @param customTaskId the taskId that will be used to initialize the new taskId
   * @param chatName [optional] used to give a chatName
   * @returns {taskId, chatStore} | null
   */
  appendInitChatStore: (
    projectId: string,
    customTaskId?: string,
    chatName?: string
  ) => {
    const {
      projects,
      createChatStore,
      getChatStore,
      setActiveChatStore: _setActiveChatStore,
      getProjectTotalTokens: _getProjectTotalTokens,
    } = get();

    if (!projectId) {
      console.warn('No active project found to appendNewChatStore');
      return null;
    }

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return null;
    }

    // Create new chat store & append in the current project
    const newChatId = createChatStore(projectId, chatName);

    if (!newChatId) {
      console.error('Failed to create new chat store');
      return null;
    }

    // Get the new chat store instance
    const newChatStore = getChatStore(projectId, newChatId);

    if (!newChatStore) {
      console.error('Failed to get new chat store instance');
      return null;
    }

    // Follow-up turns are seeded optimistically so their pending timeline is
    // visible before the long-lived /chat stream emits CONFIRMED.  When that
    // event arrives it calls this helper again with the same Run id.  Reuse
    // the seeded task instead of recreating it (which would erase the user
    // message and the pending task-log state).
    const existingTaskId =
      customTaskId && newChatStore.getState().tasks[customTaskId]
        ? customTaskId
        : null;
    const newTaskId =
      existingTaskId || newChatStore.getState().create(customTaskId);

    //Set the initTask as the active taskId
    newChatStore.getState().setActiveTaskId(newTaskId);

    return { taskId: newTaskId, chatStore: newChatStore };
  },

  setActiveChatStore: (projectId: string, chatId: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    if (!projects[projectId].chatStores[chatId]) {
      console.warn(`Chat ${chatId} not found in project ${projectId}`);
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          activeChatId: chatId,
          updatedAt: Date.now(),
        },
      },
    }));
  },

  removeChatStore: (projectId: string, chatId: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    const project = projects[projectId];
    const chatStoreKeys = Object.keys(project.chatStores);

    // Don't allow removing the last chat store
    if (chatStoreKeys.length === 1) {
      console.warn('Cannot remove the last chat store from a project');
      return;
    }

    if (!project.chatStores[chatId]) {
      console.warn(`Chat ${chatId} not found in project ${projectId}`);
      return;
    }

    // If removing the active chat, switch to another one
    let newActiveChatId = project.activeChatId;
    if (project.activeChatId === chatId) {
      const remainingChats = chatStoreKeys.filter((id) => id !== chatId);
      newActiveChatId = remainingChats[0];
    }

    set((state) => {
      const newChatStores = { ...state.projects[projectId].chatStores };
      delete newChatStores[chatId];

      return {
        projects: {
          ...state.projects,
          [projectId]: {
            ...state.projects[projectId],
            chatStores: newChatStores,
            activeChatId: newActiveChatId,
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  _evictProjectRuntime: (projectId: string) => {
    set((state) => {
      const hasProject = !!state.projects[projectId];
      const hasStaleFlag = state.staleProjectIds.has(projectId);
      if (!hasProject && !hasStaleFlag) return state;

      const update: Partial<ProjectStore> = {};
      if (hasProject) {
        const nextProjects = { ...state.projects };
        delete nextProjects[projectId];
        update.projects = nextProjects;
        const nextNavLeadByProjectId = { ...state.navLeadByProjectId };
        delete nextNavLeadByProjectId[projectId];
        update.navLeadByProjectId = nextNavLeadByProjectId;
      }
      if (state.historyLoadIncompleteProjectIds[projectId]) {
        const nextIncompleteProjectIds = {
          ...state.historyLoadIncompleteProjectIds,
        };
        delete nextIncompleteProjectIds[projectId];
        update.historyLoadIncompleteProjectIds = nextIncompleteProjectIds;
      }
      // Clearing the stale flag belongs to this helper, not the caller —
      // if the same project id is re-created later (e.g. loadProjectFromHistory
      // calls removeProject(id) then createProject(id, …)), a leftover entry
      // in staleProjectIds would cause the *fresh* runtime to be incorrectly
      // evicted on the next transition.
      if (hasStaleFlag) {
        const nextStale = new Set(state.staleProjectIds);
        nextStale.delete(projectId);
        update.staleProjectIds = nextStale;
      }
      // Deliberately leave activeProjectId alone — every caller of this
      // helper is in the middle of a transition and will overwrite it.
      return update;
    });
    releaseProjectEventStore(projectId);
  },

  _evictStaleOnTransition: (nextProjectId: string | null) => {
    const previousProjectId = get().activeProjectId;
    if (
      !previousProjectId ||
      previousProjectId === nextProjectId ||
      !get().staleProjectIds.has(previousProjectId)
    ) {
      return;
    }
    // Never evict a project that still has a live run. Eviction drops the
    // runtime chat stores, so returning to the project rebuilds it from
    // history and replays the ongoing task id -- which aborts the live
    // run's stream and kills the run on the backend. Keep the stale flag
    // so the eviction simply happens on a later, safe transition.
    const outgoingProject = get().projects[previousProjectId];
    const outgoingTaskIds = Object.values(
      outgoingProject?.chatStores ?? {}
    ).flatMap((chatStore) => Object.keys(chatStore.getState().tasks));
    if (hasActiveSSEConnection(outgoingTaskIds)) {
      return;
    }
    // _evictProjectRuntime handles staleProjectIds cleanup itself.
    get()._evictProjectRuntime(previousProjectId);
  },

  removeProject: (
    projectId: string,
    options?: { preserveEventStore?: boolean }
  ) => {
    const { activeProjectId, projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    const newActiveId = activeProjectId === projectId ? null : activeProjectId;

    set((state) => {
      const newProjects = { ...state.projects };
      delete newProjects[projectId];
      const nextNavLeadByProjectId = { ...state.navLeadByProjectId };
      delete nextNavLeadByProjectId[projectId];
      const nextIncompleteProjectIds = {
        ...state.historyLoadIncompleteProjectIds,
      };
      delete nextIncompleteProjectIds[projectId];
      // Drop any leftover stale flag for this id so a future recreation
      // (same id, different runtime) does not inherit the eviction signal.
      let nextStale = state.staleProjectIds;
      if (nextStale.has(projectId)) {
        nextStale = new Set(nextStale);
        nextStale.delete(projectId);
      }

      return {
        projects: newProjects,
        activeProjectId: newActiveId,
        navLeadByProjectId: nextNavLeadByProjectId,
        historyLoadIncompleteProjectIds: nextIncompleteProjectIds,
        staleProjectIds: nextStale,
      };
    });
    if (options?.preserveEventStore) {
      resetProjectEventStore(projectId);
    } else {
      releaseProjectEventStore(projectId);
    }
    usePageTabStore.getState().removeSessionPreviewProject(projectId);
    useSpaceStore.getState().removeProjectMeta(projectId);
    const effortPersistence = thinkingEffortPersistenceByProject.get(projectId);
    if (effortPersistence) {
      effortPersistence.removed = true;
      if (effortPersistence.pendingCount === 0) {
        thinkingEffortPersistenceByProject.delete(projectId);
      }
    }
  },

  updateProject: (
    projectId: string,
    updates: Partial<Omit<Project, 'id' | 'createdAt'>>
  ) => {
    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          ...updates,
          metadata:
            updates.metadata === undefined
              ? state.projects[projectId].metadata
              : {
                  ...state.projects[projectId].metadata,
                  ...updates.metadata,
                },
          updatedAt: Date.now(),
        },
      },
    }));
    const updatedProject = get().projects[projectId];
    if (updatedProject) {
      upsertSpaceProjectMetaFromProject(updatedProject);
    }
  },

  /**
   * Simplified replay functionality
   * @param taskIds - array of taskIds to replay
   * @param projectId - optional projectId to create/overwrite
   * @param historyId - optional, used to init historyId to new project
   * @returns the created project ID
   */
  replayProject: (
    taskIds: string[],
    question: string = 'Replay task',
    projectId?: string,
    historyId?: string
  ) => {
    const { projects, removeProject, createProject, createChatStore } = get();

    let replayProjectId: string;

    //TODO: For now handle the question as unique identifier to avoid duplicate
    if (!projectId) projectId = 'Replay: ' + question;

    if (!taskIds || taskIds.length === 0) {
      console.warn('[ProjectStore] No taskIds provided for replayProject');
      return createProject(
        `Replay Project ${question}`,
        `No tasks to replay`,
        projectId,
        ProjectType.NORMAL,
        historyId
      );
    }

    // If projectId is provided, reset that project
    if (projectId) {
      if (projects[projectId]) {
        console.log(`[ProjectStore] Overwriting existing project ${projectId}`);
        removeProject(projectId, { preserveEventStore: true });
      }
      // Create project with the specific naming
      replayProjectId = createProject(
        `Replay Project ${question}`,
        `Replayed project from ${question}`,
        projectId,
        ProjectType.REPLAY,
        historyId
      );
    } else {
      // Create a new project only once
      replayProjectId = createProject(
        `Replay Project ${question}`,
        `Replayed project with ${taskIds.length} tasks`,
        projectId,
        ProjectType.REPLAY,
        historyId
      );
    }

    console.log(
      `[ProjectStore] Created replay project ${replayProjectId} for ${taskIds.length} tasks`
    );

    // For each taskId, create a chat store within the project and call replay
    (async () => {
      get()._evictStaleOnTransition(replayProjectId);
      set({ activeProjectId: replayProjectId });
      let cancelled = false;
      for (let index = 0; index < taskIds.length; index++) {
        if (get().activeProjectId !== replayProjectId) {
          console.log(
            `[ProjectStore] Cancelled replay: active project changed from ${replayProjectId}`
          );
          cancelled = true;
          break;
        }
        const taskId = taskIds[index];
        console.log(
          `[ProjectStore] Creating replay for task ${index + 1}/${taskIds.length}: ${taskId}`
        );

        // Create a new chat store for this task
        const chatId = createChatStore(replayProjectId, `Task ${taskId}`);

        if (chatId) {
          const project = get().projects[replayProjectId];
          const chatStore = project.chatStores[chatId];

          if (chatStore) {
            try {
              await chatStore.getState().replay(taskId, question, 0.2);
              console.log(`[ProjectStore] Started replay for task ${taskId}`);
            } catch (error) {
              console.error(
                `[ProjectStore] Failed to replay task ${taskId}:`,
                error
              );
            }
          }
        }
      }
      if (!cancelled) {
        console.log(
          `[ProjectStore] Completed replay setup for ${taskIds.length} tasks`
        );
      }
    })();

    return replayProjectId;
  },

  loadProjectFromHistory: async (
    taskIds: string[],
    question: string,
    projectId: string,
    historyId?: string,
    projectName?: string,
    spaceId?: string,
    taskQuestionsById?: Record<string, string>,
    serverUpdatedAt?: number | null,
    options?: LoadProjectFromHistoryOptions
  ) => {
    if (
      options?.requireActiveSelection &&
      get().activeProjectId !== projectId
    ) {
      console.log(
        `[ProjectStore] Ignored stale history load for ${projectId}; active selection is ${get().activeProjectId}`
      );
      return projectId;
    }
    if (get().historyLoadingProjectIds[projectId]) {
      console.log(
        `[ProjectStore] Ignored duplicate in-flight history load for ${projectId}`
      );
      return projectId;
    }

    const { projects, removeProject, createProject, createChatStore } = get();
    const existingProject = projects[projectId];
    const existingMeta = useSpaceStore.getState().getProjectMeta(projectId);
    const projectNameCandidate = (projectName ?? '').trim();
    const existingMetaName = (existingMeta?.name ?? '').trim();
    const existingProjectName = (existingProject?.name ?? '').trim();
    const displayName =
      projectNameCandidate &&
      !isPlaceholderProjectName(projectNameCandidate, projectId)
        ? projectNameCandidate
        : existingMetaName &&
            !isPlaceholderProjectName(existingMetaName, projectId)
          ? existingMetaName
          : existingProjectName &&
              !isPlaceholderProjectName(existingProjectName, projectId)
            ? existingProjectName
            : question.slice(0, 50) || 'Project';

    if (projects[projectId]) {
      console.log(
        `[ProjectStore] Overwriting existing project ${projectId} for load`
      );
      removeProject(projectId, { preserveEventStore: true });
    }

    const loadProjectId = createProject(
      displayName,
      `Loaded from history`,
      projectId,
      ProjectType.REPLAY,
      historyId,
      true,
      {
        spaceId: existingMeta?.spaceId ?? existingProject?.spaceId ?? spaceId,
        mode: existingMeta?.mode ?? existingProject?.mode ?? null,
        workdirMode:
          existingMeta?.workdirMode ?? existingProject?.workdirMode ?? null,
        metadata: {
          ...existingProject?.metadata,
          ...existingMeta?.metadata,
        },
        createdAt: existingMeta?.createdAt ?? existingProject?.createdAt,
        updatedAt: existingMeta?.updatedAt ?? existingProject?.updatedAt,
      }
    );

    // The createProject call above already runs the stale-eviction hook
    // (setActive=true). Re-asserting here is a cheap no-op in the common
    // case but keeps the "every direct write to activeProjectId honours
    // the eviction contract" invariant readable at every write site.
    get()._evictStaleOnTransition(loadProjectId);
    set({ activeProjectId: loadProjectId });
    get().setHistoryLoadingProject(loadProjectId, true);
    get().setHistoryLoadIncomplete(loadProjectId, true);
    console.log(
      `[ProjectStore] Loading project ${loadProjectId} with ${taskIds.length} tasks (final state, no replay)`
    );

    const cacheUserId = getAuthStore().user_id;
    // Cache usage requires both an authenticated user (to scope per-account)
    // AND a non-null server freshness anchor. Without the latter we cannot
    // detect staleness, so we neither read from nor write to the cache —
    // better to pay the SSE replay cost than serve un-validatable data.
    const cacheScope =
      cacheUserId != null && serverUpdatedAt != null
        ? { userId: cacheUserId, projectId: loadProjectId }
        : null;

    try {
      // A local RunJournal entry is newer and stronger than both the legacy
      // cloud playback projection and an IndexedDB snapshot derived from it.
      // Query once per Project, then replay matching tasks through Brain's
      // canonical SQLite stream. Projects created on another device have no
      // local Run and intentionally retain the cloud fallback.
      const localRunsById = new Map<
        string,
        {
          status?: DurableRunDisplayStatus;
          totalAttemptElapsedMs?: number;
          createdAt?: number;
          updatedAt?: number;
        }
      >();
      let localCanonicalUpdatedAt: number | null = null;
      try {
        const localRunController = new AbortController();
        const localRunDeadline = setTimeout(
          () => localRunController.abort(),
          LOCAL_RUN_ENRICHMENT_BUDGET_MS
        );
        const localRuns = await fetchProjectRuns(
          loadProjectId,
          100,
          localRunController.signal
        ).finally(() => clearTimeout(localRunDeadline));
        for (const run of localRuns?.runs ?? []) {
          if (run?.run_id) {
            if (
              typeof run.updated_at === 'number' &&
              Number.isFinite(run.updated_at)
            ) {
              localCanonicalUpdatedAt = Math.max(
                localCanonicalUpdatedAt ?? run.updated_at,
                run.updated_at
              );
            }
            localRunsById.set(String(run.run_id), {
              status: durableRunDisplayStatus(run.status),
              totalAttemptElapsedMs:
                typeof run.total_attempt_elapsed_ms === 'number' &&
                Number.isFinite(run.total_attempt_elapsed_ms) &&
                run.total_attempt_elapsed_ms >= 0
                  ? run.total_attempt_elapsed_ms
                  : undefined,
              createdAt:
                typeof run.created_at === 'number' &&
                Number.isFinite(run.created_at)
                  ? run.created_at
                  : undefined,
              updatedAt:
                typeof run.updated_at === 'number' &&
                Number.isFinite(run.updated_at)
                  ? run.updated_at
                  : undefined,
            });
          }
        }
      } catch (localRunError) {
        console.info(
          `[ProjectStore] Local RunJournal unavailable for ${loadProjectId}; using cloud history`,
          localRunError
        );
      }

      // Fast path: rehydrate only a cache snapshot proven current by the
      // server freshness anchor. If the server moved on while the renderer
      // was detached, discard the snapshot and replay during this same open.
      // Showing stale progress until a second navigation contradicts the
      // RunJournal's canonical terminal state and can leave a completed Run
      // looking permanently active.
      //
      // Concurrency: the `await getCachedProject` yields control. The user
      // might switch to a different project before it resolves. We bail
      // before mutating state if the active project no longer matches.
      if (cacheScope) {
        try {
          const cached = await getCachedProject(cacheScope);
          if (get().activeProjectId !== loadProjectId) {
            return loadProjectId;
          }
          const cacheIsStale = Boolean(
            cached &&
            (cached.serverUpdatedAt == null ||
              (serverUpdatedAt as number) > cached.serverUpdatedAt ||
              (cached.localCanonicalUpdatedAt ?? null) !==
                localCanonicalUpdatedAt)
          );
          if (cacheIsStale) {
            await deleteCachedProject(cacheScope);
            console.info(
              `[ProjectStore] Discarded stale cache for ${loadProjectId}; replaying latest history`
            );
          }
          const cacheHasIncompleteTask = Boolean(
            cached &&
            cached.taskIds.some((taskId) => {
              const taskState = cached.tasks[taskId]?.taskState;
              return cachedTaskProjectionIsIncomplete(
                taskState,
                localRunsById.get(taskId)?.status
              );
            })
          );
          if (!cacheIsStale && cacheHasIncompleteTask) {
            await deleteCachedProject(cacheScope);
            console.warn(
              `[ProjectStore] Discarded incomplete cache for ${loadProjectId}; replaying canonical history`
            );
          }
          if (
            !cacheIsStale &&
            !cacheHasIncompleteTask &&
            cached &&
            cached.taskIds.length > 0
          ) {
            const rehydratedStores = new Map<string, VanillaChatStore>();
            let repairedCachedTasks: Record<string, CachedTask> | null = null;
            for (const cachedTaskId of cached.taskIds) {
              const cachedTask = cached.tasks[cachedTaskId];
              if (!cachedTask) continue;
              const chatId = createChatStore(
                loadProjectId,
                `Task ${cachedTaskId}`
              );
              if (!chatId) continue;
              const project = get().projects[loadProjectId];
              const chatStore = project?.chatStores[chatId];
              if (!chatStore) continue;
              chatStore
                .getState()
                .hydrateTask(cachedTaskId, cachedTask.taskState as any);

              // A matching freshness anchor proves that this snapshot was
              // built from the current Run rows, but it does not prove that
              // every derived UI field was projected correctly. Older
              // renderer code could persist elapsed=0 even though SQLite
              // already held the attempt duration. Always overlay canonical
              // terminal duration, and re-anchor a running clock from the
              // current attempt aggregate, so a bad projection cannot remain
              // trusted forever.
              const localRun = localRunsById.get(cachedTaskId);
              if (localRun) {
                const canonicalElapsed =
                  localRun.status === 'running' ||
                  (localRun.status &&
                    TERMINAL_DURABLE_RUN_DISPLAY_STATUSES.has(localRun.status))
                    ? resolveHistoricalRunElapsedMs({
                        totalAttemptElapsedMs: localRun.totalAttemptElapsedMs,
                        createdAt: localRun.createdAt,
                        updatedAt: localRun.updatedAt,
                      })
                    : undefined;
                const chatState = chatStore.getState();
                chatState.setDurableRunStatus(cachedTaskId, localRun.status);
                if (canonicalElapsed !== undefined) {
                  chatState.setElapsed(cachedTaskId, canonicalElapsed);
                  chatState.setTaskTime(
                    cachedTaskId,
                    localRun.status === 'running' ? Date.now() : 0
                  );
                }

                const cachedTaskState =
                  cachedTask.taskState &&
                  typeof cachedTask.taskState === 'object' &&
                  !Array.isArray(cachedTask.taskState)
                    ? (cachedTask.taskState as Record<string, unknown>)
                    : {};
                const needsRepair =
                  cachedTaskState.durableRunStatus !== localRun.status ||
                  (canonicalElapsed !== undefined &&
                    (cachedTaskState.elapsed !== canonicalElapsed ||
                      cachedTaskState.taskTime !== 0));
                if (needsRepair) {
                  repairedCachedTasks ??= { ...cached.tasks };
                  repairedCachedTasks[cachedTaskId] = {
                    taskState: {
                      ...cachedTaskState,
                      durableRunStatus: localRun.status,
                      ...(canonicalElapsed !== undefined
                        ? { elapsed: canonicalElapsed, taskTime: 0 }
                        : {}),
                    },
                  };
                }
              }
              rehydratedStores.set(cachedTaskId, chatStore);
            }

            if (rehydratedStores.size > 0) {
              // Re-check after sync rehydration — `createChatStore` could
              // have intermixed with a setActiveProject from another caller.
              if (get().activeProjectId !== loadProjectId) {
                return loadProjectId;
              }
              const lastTaskId = cached.taskIds[cached.taskIds.length - 1];
              const lastStore = rehydratedStores.get(lastTaskId);
              const activeTask = lastStore?.getState().tasks[lastTaskId];
              if (activeTask) {
                get().setProjectNavLead(
                  loadProjectId,
                  getSessionNavLeadPresentation(activeTask)
                );
              }
              console.log(
                `[ProjectStore] Hydrated ${loadProjectId} from cache (${rehydratedStores.size} tasks)`
              );

              get().setHistoryLoadIncomplete(loadProjectId, false);

              if (
                repairedCachedTasks &&
                getAuthStore().user_id === cacheScope.userId
              ) {
                // Best-effort self-heal. SQLite remains authoritative; this
                // only prevents the same stale derived value from needing to
                // be corrected again on every project open.
                void putCachedProject(cacheScope, {
                  serverUpdatedAt: cached.serverUpdatedAt,
                  localCanonicalUpdatedAt,
                  taskIds: cached.taskIds,
                  tasks: repairedCachedTasks,
                  projectName: cached.projectName,
                }).catch(() => undefined);
              }

              return loadProjectId;
            }
          }
        } catch (cacheReadError) {
          console.warn(
            '[ProjectStore] Cache rehydrate failed, falling back to replay:',
            cacheReadError
          );
        }
      }

      let cancelled = false;
      const loadedChatStoresByTaskId = new Map<string, VanillaChatStore>();
      for (let index = 0; index < taskIds.length; index++) {
        if (get().activeProjectId !== loadProjectId) {
          console.log(
            `[ProjectStore] Cancelled loading: active project changed from ${loadProjectId}`
          );
          cancelled = true;
          break;
        }
        const taskId = taskIds[index];
        console.log(
          `[ProjectStore] Loading task ${index + 1}/${taskIds.length}: ${taskId}`
        );
        const chatId = createChatStore(loadProjectId, `Task ${taskId}`);
        if (chatId) {
          const project = get().projects[loadProjectId];
          const chatStore = project.chatStores[chatId];
          if (chatStore) {
            try {
              const replay = chatStore.getState().replay;
              if (localRunsById.has(taskId)) {
                const localRun = localRunsById.get(taskId);
                // An active durable stream can stay attached while waiting
                // for approval. `replay()` creates the Task synchronously
                // before its first await, so start it first and then publish
                // the canonical status before awaiting the attached stream.
                // Otherwise `setDurableRunStatus` would target a Task that
                // does not exist yet and the approval card becomes read-only.
                const replayPromise = replay(
                  taskId,
                  taskQuestionsById?.[taskId] || question,
                  0,
                  loadProjectId,
                  'local_durable',
                  {
                    detachAfterCatchUp: Boolean(
                      localRun?.status &&
                      !TERMINAL_DURABLE_RUN_DISPLAY_STATUSES.has(
                        localRun.status
                      )
                    ),
                  }
                );
                chatStore
                  .getState()
                  .setDurableRunStatus(taskId, localRun?.status);
                if (
                  localRun?.status === 'running' &&
                  localRun.totalAttemptElapsedMs !== undefined &&
                  chatStore.getState().tasks[taskId]
                ) {
                  // `/runs` measures the active Attempt up to the history
                  // request. Continue from that canonical baseline while the
                  // attached stream is still open; otherwise replay's first
                  // TODO event restarts the visible clock at Date.now().
                  chatStore
                    .getState()
                    .setElapsed(taskId, localRun.totalAttemptElapsedMs);
                  chatStore.getState().setTaskTime(taskId, Date.now());
                }
                await replayPromise;
                const canonicalElapsed =
                  localRun?.status &&
                  TERMINAL_DURABLE_RUN_DISPLAY_STATUSES.has(localRun.status)
                    ? resolveHistoricalRunElapsedMs({
                        totalAttemptElapsedMs: localRun?.totalAttemptElapsedMs,
                        createdAt: localRun?.createdAt,
                        updatedAt: localRun?.updatedAt,
                      })
                    : undefined;
                chatStore
                  .getState()
                  .setDurableRunStatus(taskId, localRun?.status);
                if (
                  canonicalElapsed !== undefined &&
                  chatStore.getState().tasks[taskId]
                ) {
                  // The reducer also derives a timestamp-based fallback from
                  // the replayed events. Prefer SQLite's attempt aggregate:
                  // it excludes the offline gap before an explicit Resume.
                  chatStore.getState().setElapsed(taskId, canonicalElapsed);
                  chatStore.getState().setTaskTime(taskId, 0);
                }
              } else {
                await replay(
                  taskId,
                  taskQuestionsById?.[taskId] || question,
                  0,
                  loadProjectId
                );
              }
              loadedChatStoresByTaskId.set(taskId, chatStore);
              console.log(`[ProjectStore] Loaded task ${taskId}`);
            } catch (error) {
              console.error(
                `[ProjectStore] Failed to load task ${taskId}:`,
                error
              );
            }
          }
        }
      }

      // Polish leftover non-terminal subtask statuses for tasks that the
      // server marks as done. See `polishCompletedHistoryTask` above for why.
      if (!cancelled && loadedChatStoresByTaskId.size > 0) {
        try {
          const grouped = await proxyFetchGet(
            `/api/v1/chat/histories/grouped/${projectId}`,
            { include_tasks: true }
          );
          const doneTaskIds = new Set<string>();
          const stoppedTaskIds = new Set<string>();
          for (const t of grouped?.tasks ?? []) {
            if (!t?.task_id || t?.status !== HISTORY_STATUS_DONE) continue;
            // Skip the polish for tasks the user explicitly stopped — the
            // skip_task backend path also marks status=done, but the run
            // genuinely didn't complete and the unfinished subtasks should
            // stay Pending.
            if (
              typeof t?.summary === 'string' &&
              t.summary.startsWith(STOPPED_BY_USER_SUMMARY_PREFIX)
            ) {
              stoppedTaskIds.add(t.task_id);
              continue;
            }
            doneTaskIds.add(t.task_id);
          }
          for (const [taskId, chatStore] of loadedChatStoresByTaskId) {
            if (stoppedTaskIds.has(taskId)) {
              chatStore.getState().setDurableRunStatus(taskId, 'stopped');
            }
            if (doneTaskIds.has(taskId)) {
              polishCompletedHistoryTask(chatStore, taskId);
            }
          }
        } catch (error) {
          console.warn(
            '[ProjectStore] Failed to polish history subtask statuses:',
            error
          );
        }
      }

      if (!cancelled) {
        const project = get().projects[loadProjectId];
        const chatStore =
          (project?.activeChatId
            ? project.chatStores[project.activeChatId]
            : null) ??
          loadedChatStoresByTaskId.values().next().value ??
          null;
        const chatState = chatStore?.getState();
        const activeTask = chatState?.activeTaskId
          ? chatState.tasks[chatState.activeTaskId]
          : undefined;
        if (activeTask) {
          get().setProjectNavLead(
            loadProjectId,
            getSessionNavLeadPresentation(activeTask)
          );
        }
        console.log(
          `[ProjectStore] Completed loading project ${loadProjectId}`
        );

        // Persist the freshly-reconstructed state so the next session can
        // skip the SSE replay entirely. Best-effort — IDB failures (quota,
        // private mode) are logged inside the wrapper and never block.
        //
        // Skip the write when:
        // 1. `cacheScope` is null — caller had no userId, no serverUpdatedAt,
        //    or both. We cannot anchor a freshness check, so writing would
        //    create un-evictable entries. Local canonical Projects additionally
        //    carry SQLite's max Run.updated_at, so IDB remains only a verified,
        //    disposable UI projection rather than a competing source of truth.
        // 2. The user logged out (or switched accounts) during the replay.
        //    cacheScope.userId was captured at function start; if it no
        //    longer matches the live session, writing would leak this
        //    user's data.
        // 3. Any task failed to replay. Persisting a partial project would
        //    cache the missing-task state as "final" — the next open would
        //    hit the cache and never retry the failed task.
        const liveUserId = getAuthStore().user_id;
        const allTasksLoaded = taskIds.every((taskId) => {
          const loadedStore = loadedChatStoresByTaskId.get(taskId);
          return Boolean(loadedStore?.getState().tasks[taskId]);
        });
        if (allTasksLoaded && taskIds.length > 0) {
          get().setHistoryLoadIncomplete(loadProjectId, false);
        }
        if (
          cacheScope &&
          liveUserId === cacheScope.userId &&
          allTasksLoaded &&
          loadedChatStoresByTaskId.size > 0
        ) {
          const tasksSnapshot: Record<string, CachedTask> = {};
          const cachedTaskIds: string[] = [];
          let snapshotComplete = true;
          for (const taskId of taskIds) {
            const chatStore = loadedChatStoresByTaskId.get(taskId);
            const taskState = chatStore?.getState().tasks[taskId];
            if (!taskState) {
              snapshotComplete = false;
              break;
            }
            // Every persisted task has at least its originating user message.
            // An empty message projection cannot render the conversation and
            // must never become a freshness-anchored cache hit that suppresses
            // authoritative SQLite replay on future opens.
            if (
              !Array.isArray(taskState.messages) ||
              taskState.messages.length === 0
            ) {
              console.warn(
                `[ProjectStore] Skipping incomplete cache snapshot for task ${taskId}`
              );
              snapshotComplete = false;
              break;
            }
            // Task state contains FileInfo entries with React component
            // references in `icon` (LucideIcon etc) and File objects in
            // `attaches`. Neither survives IDB's structured clone, so
            // round-trip through JSON to strip them. Functions, symbols,
            // and undefined fields are dropped by JSON; we lose nothing
            // that hydrateTask cares about (the volatile fields it
            // already zeroes out cover the small set of stripped values).
            let serializable: unknown;
            try {
              serializable = JSON.parse(JSON.stringify(taskState));
            } catch (serializeError) {
              console.warn(
                `[ProjectStore] Failed to serialize task ${taskId} for cache:`,
                serializeError
              );
              snapshotComplete = false;
              break;
            }
            tasksSnapshot[taskId] = { taskState: serializable };
            cachedTaskIds.push(taskId);
          }
          if (snapshotComplete && cachedTaskIds.length === taskIds.length) {
            void putCachedProject(cacheScope, {
              serverUpdatedAt: serverUpdatedAt as number,
              localCanonicalUpdatedAt,
              taskIds: cachedTaskIds,
              tasks: tasksSnapshot,
              projectName: displayName,
            }).catch(() => undefined);
          }
        }
      }
    } finally {
      get().setHistoryLoadingProject(loadProjectId, false);
    }
    return loadProjectId;
  },

  mergeProjectHistory: async (
    projectId: string,
    tasks: Array<{ task_id?: string | null; question?: string | null }>,
    fallbackQuestion: string = ''
  ) => {
    if (!get().projects[projectId]) {
      return;
    }
    if (get().historyLoadingProjectIds[projectId]) {
      return;
    }

    let chatStore = get().getChatStore(projectId);
    if (!chatStore) {
      get().createChatStore(projectId);
      chatStore = get().getChatStore(projectId);
    }
    if (!chatStore) {
      return;
    }

    const historyTaskIds = tasks
      .map((task) => (task.task_id ? String(task.task_id) : ''))
      .filter(Boolean);
    const existingTaskIds = new Set(
      Object.values(get().projects[projectId]?.chatStores ?? {}).flatMap(
        (store) => Object.keys(store.getState().tasks)
      )
    );
    const tasksToReplay = tasks
      .map((task) => ({
        taskId: task.task_id ? String(task.task_id) : '',
        question: task.question ? String(task.question) : fallbackQuestion,
      }))
      .filter((task) => task.taskId && !existingTaskIds.has(task.taskId));

    if (tasksToReplay.length === 0) {
      get().updateProject(projectId, {
        metadata: { remoteHistoryHydrationPending: false },
      });
      return;
    }

    get().setHistoryLoadingProject(projectId, true);
    try {
      for (const task of tasksToReplay) {
        const targetChatStore = get().getChatStore(projectId) || chatStore;
        const beforeActiveTaskId = targetChatStore.getState().activeTaskId;
        await targetChatStore
          .getState()
          .replay(task.taskId, task.question || fallbackQuestion, 0, projectId);

        const stateAfterReplay = targetChatStore.getState();
        if (
          beforeActiveTaskId &&
          stateAfterReplay.activeTaskId === task.taskId &&
          stateAfterReplay.tasks[beforeActiveTaskId]
        ) {
          stateAfterReplay.setActiveTaskId(beforeActiveTaskId);
        }
        existingTaskIds.add(task.taskId);
      }
      Object.values(get().projects[projectId]?.chatStores ?? {}).forEach(
        (store) => {
          const state = store.getState();
          const currentTasks = state.tasks;
          const orderedTasks: typeof currentTasks = {};
          for (const taskId of historyTaskIds) {
            if (currentTasks[taskId]) {
              orderedTasks[taskId] = currentTasks[taskId];
            }
          }
          for (const [taskId, task] of Object.entries(currentTasks)) {
            if (!orderedTasks[taskId]) {
              orderedTasks[taskId] = task;
            }
          }
          if (Object.keys(orderedTasks).length > 0) {
            (store as any).setState({ tasks: orderedTasks });
          }
        }
      );
      get().updateProject(projectId, {
        metadata: { remoteHistoryHydrationPending: false },
      });
    } finally {
      get().setHistoryLoadingProject(projectId, false);
    }
  },

  saveChatStore: (
    projectId: string,
    chatId: string,
    state: VanillaChatStore
  ) => {
    const { projects } = get();

    if (projects[projectId] && projects[projectId].chatStores[chatId]) {
      set((currentState) => ({
        projects: {
          ...currentState.projects,
          [projectId]: {
            ...currentState.projects[projectId],
            chatStores: {
              ...currentState.projects[projectId].chatStores,
              [chatId]: state,
            },
            updatedAt: Date.now(),
          },
        },
      }));
    }
  },

  getChatStore: (projectId?: string, chatId?: string) => {
    const { projects, activeProjectId } = get();

    // Use provided projectId or fall back to activeProjectId
    const targetProjectId = projectId || activeProjectId;

    if (targetProjectId && projects[targetProjectId]) {
      const project = projects[targetProjectId];

      // Use provided chatId or fall back to activeChatId
      const targetChatId = chatId || project.activeChatId;

      if (targetChatId && project.chatStores[targetChatId]) {
        return project.chatStores[targetChatId];
      }

      // If no active chat or chat not found, return the first available one
      const chatStoreKeys = Object.keys(project.chatStores);
      if (chatStoreKeys.length > 0) {
        return project.chatStores[chatStoreKeys[0]];
      }
    }

    return null;
  },

  peekActiveChatStore: (projectId?: string) => {
    const { projects, activeProjectId } = get();
    const targetProjectId = projectId || activeProjectId;
    if (!targetProjectId) return null;
    const project = projects[targetProjectId];
    if (!project) return null;

    if (project.activeChatId && project.chatStores[project.activeChatId]) {
      return project.chatStores[project.activeChatId];
    }

    const firstChatId = Object.keys(project.chatStores || {})[0];
    return firstChatId ? project.chatStores[firstChatId] : null;
  },

  getActiveChatStore: (projectId?: string) => {
    const { projects, activeProjectId } = get();

    const targetProjectId = projectId || activeProjectId;

    if (targetProjectId && projects[targetProjectId]) {
      const project = projects[targetProjectId];

      if (project.activeChatId && project.chatStores[project.activeChatId]) {
        return project.chatStores[project.activeChatId];
      }

      const chatStoreKeys = Object.keys(project.chatStores);
      if (chatStoreKeys.length > 0) {
        return project.chatStores[chatStoreKeys[0]];
      }
    }

    return null;
  },

  // Project-level queued messages management
  addQueuedMessage: (
    projectId: string,
    content: string,
    attaches: File[],
    task_id?: string,
    executionId?: string,
    triggerTaskId?: string,
    triggerId?: number,
    triggerName?: string,
    source?: 'local' | 'remote_control' | 'scheduled'
  ) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return null;
    }

    // Check if message with same executionId already exists to avoid duplicates
    if (executionId) {
      const existingMessage = projects[projectId].queuedMessages.find(
        (m) => m.executionId === executionId
      );
      if (existingMessage) {
        console.warn(
          `[addQueuedMessage] Message with executionId ${executionId} already queued, skipping duplicate`
        );
        return existingMessage.task_id;
      }
    }

    const new_task_id = generateUniqueId();
    const actual_task_id = task_id || new_task_id;

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          queuedMessages: [
            ...state.projects[projectId].queuedMessages,
            {
              task_id: actual_task_id,
              run_id: actual_task_id,
              content,
              timestamp: Date.now(),
              attaches: [...attaches],
              executionId,
              triggerTaskId,
              triggerId,
              triggerName,
              source,
            },
          ],
          updatedAt: Date.now(),
        },
      },
    }));

    console.log(
      `[addQueuedMessage] Message added successfully: task_id=${actual_task_id}, queue length now: ${get().projects[projectId].queuedMessages.length}`
    );

    return actual_task_id;
  },

  removeQueuedMessage: (projectId: string, task_id: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return {
        task_id: '',
        run_id: '',
        content: '',
        timestamp: 0,
        attaches: [],
      };
    }

    const messageToRemove = projects[projectId].queuedMessages.find(
      (m) => m.task_id === task_id
    );

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          queuedMessages: state.projects[projectId].queuedMessages.filter(
            (m) => m.task_id !== task_id
          ),
          updatedAt: Date.now(),
        },
      },
    }));

    return (
      messageToRemove || {
        task_id: '',
        run_id: '',
        content: '',
        timestamp: 0,
        attaches: [],
      }
    );
  },

  // Method to restore a queued message (for error handling)
  restoreQueuedMessage: (projectId: string, messageData: TaskQueue) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    // Check if message already exists to avoid duplicates
    const existingMessage = projects[projectId].queuedMessages.find(
      (m) => m.task_id === messageData.task_id
    );
    if (existingMessage) {
      console.warn(
        `Message with task_id ${messageData.task_id} already exists`
      );
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          queuedMessages: [
            ...state.projects[projectId].queuedMessages,
            {
              ...messageData,
              run_id: messageData.run_id || messageData.task_id,
            },
          ],
          updatedAt: Date.now(),
        },
      },
    }));
  },

  clearQueuedMessages: (projectId: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          queuedMessages: [],
          updatedAt: Date.now(),
        },
      },
    }));
  },

  markQueuedMessageAsProcessing: (projectId: string, taskId: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    const message = projects[projectId].queuedMessages.find(
      (m) => m.task_id === taskId
    );

    if (!message) {
      console.warn(
        `Message with task_id ${taskId} not found in project ${projectId}`
      );
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          queuedMessages: state.projects[projectId].queuedMessages.map((m) =>
            m.task_id === taskId ? { ...m, processing: true } : m
          ),
          updatedAt: Date.now(),
        },
      },
    }));

    console.log(
      `[ProjectStore] Marked message as processing: ${taskId} in project ${projectId}`
    );
  },

  setQueuedMessageProcessing: (
    projectId: string,
    taskId: string,
    processing: boolean
  ) => {
    const { projects } = get();
    if (!projects[projectId]) return;
    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          queuedMessages: state.projects[projectId].queuedMessages.map(
            (item) => (item.task_id === taskId ? { ...item, processing } : item)
          ),
          updatedAt: Date.now(),
        },
      },
    }));
  },

  prioritizeQueuedMessage: (projectId: string, taskId: string) => {
    const { projects } = get();
    if (!projects[projectId]) return;
    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          queuedMessages: state.projects[projectId].queuedMessages.map(
            (item) => {
              if (item.executionId) return item;
              return { ...item, sendNow: item.task_id === taskId };
            }
          ),
          updatedAt: Date.now(),
        },
      },
    }));
  },

  getAllChatStores: (projectId: string) => {
    const { projects } = get();

    if (projects[projectId]) {
      const project = projects[projectId];
      const chatStoreEntries = Object.entries(project.chatStores);

      // Sort by creation timestamp (oldest first)
      return chatStoreEntries
        .map(([chatId, chatStore]) => ({
          chatId,
          chatStore,
          createdAt: project.chatStoreTimestamps?.[chatId] || 0,
        }))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ chatId, chatStore }) => ({
          chatId,
          chatStore,
        }));
    }

    return [];
  },

  getAllProjects: (spaceId?: string) => {
    const { projects } = get();
    const spaceStore = useSpaceStore.getState();
    const metaProjects = spaceStore
      .getProjectsForSpace(spaceId)
      .map((meta) => mergeProjectMeta(projects[meta.id], meta));
    const metaProjectIds = new Set(metaProjects.map((project) => project.id));
    const localOnlyProjects = Object.values(projects).filter(
      (project) =>
        !metaProjectIds.has(project.id) &&
        project.metadata?.serverSynced !== true &&
        (!spaceId ||
          project.spaceId === spaceId ||
          (!project.spaceId && spaceId.startsWith('legacy_')))
    );
    return [...metaProjects, ...localOnlyProjects].sort(
      (a, b) => b.createdAt - a.createdAt
    );
  },

  getProjectById: (projectId: string) => {
    const { projects } = get();
    let project: Project | null = projects[projectId] || null;
    if (!project) {
      const meta = useSpaceStore.getState().getProjectMeta(projectId);
      project = meta ? projectShellFromMeta(meta) : null;
    } else {
      const meta = useSpaceStore.getState().getProjectMeta(projectId);
      if (meta) {
        project = mergeProjectMeta(project, meta);
      }
    }

    // Ensure backwards compatibility - add queuedMessages if it doesn't exist
    if (project && !project.queuedMessages) {
      project.queuedMessages = [];
    }
    if (project?.queuedMessages) {
      project.queuedMessages = project.queuedMessages.map((message) => ({
        ...message,
        run_id: message.run_id || message.task_id,
      }));
    }

    // Ensure backwards compatibility - add chatStoreTimestamps if it doesn't exist
    if (project && !project.chatStoreTimestamps) {
      project.chatStoreTimestamps = {};
      // Initialize timestamps for existing chat stores with project creation time
      Object.keys(project.chatStores).forEach((chatId) => {
        project.chatStoreTimestamps[chatId] = project.createdAt;
      });
    }

    return project;
  },

  getProjectTotalTokens: (projectId: string) => {
    const { projects } = get();
    const project = projects[projectId];

    if (!project) {
      console.warn(`Project ${projectId} not found for token calculation`);
      return 0;
    }

    let totalTokens = 0;

    // Iterate through all chat stores in the project
    Object.values(project.chatStores).forEach((chatStore) => {
      if (chatStore && chatStore.getState) {
        const chatState = chatStore.getState();
        // Iterate through all tasks in the chat store
        Object.values(chatState.tasks).forEach((task) => {
          if (task && typeof task.tokens === 'number') {
            totalTokens += task.tokens;
          }
        });
      }
    });

    return totalTokens;
  },

  setHistoryId: (projectId: string, historyId: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found for setting history ID`);
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          metadata: {
            ...state.projects[projectId].metadata,
            historyId,
            serverSynced: true,
          },
          updatedAt: Date.now(),
        },
      },
    }));
    const updatedProject = get().projects[projectId];
    if (updatedProject) {
      upsertSpaceProjectMetaFromProject(updatedProject);
    }
  },

  getHistoryId: (projectId: string | null) => {
    if (!projectId) {
      console.warn(`Project id is null for getting history ID`);
      return null;
    }

    const { projects } = get();
    const project = projects[projectId];

    if (!project) {
      console.warn(`Project ${projectId} not found for getting history ID`);
      return null;
    }

    return project.metadata?.historyId || null;
  },

  setProjectModel: (
    projectId: string,
    modelSelection: ProjectModelSelection
  ) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found for setting model`);
      return;
    }

    const previous = projects[projectId].metadata?.modelSelection;
    if (
      previous &&
      previous.modelType === modelSelection.modelType &&
      previous.cloud_model_type === modelSelection.cloud_model_type &&
      previous.codex_model_type === modelSelection.codex_model_type &&
      previous.provider_id === modelSelection.provider_id &&
      previous.model_platform === modelSelection.model_platform &&
      previous.model_type === modelSelection.model_type
    ) {
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          metadata: {
            ...state.projects[projectId].metadata,
            modelSelection,
          },
          updatedAt: Date.now(),
        },
      },
    }));
    const updatedProject = get().projects[projectId];
    if (updatedProject) {
      upsertSpaceProjectMetaFromProject(updatedProject);
    }

    // Server metadata is shallow-merged, so persisting only the pin keeps the
    // selection across restarts and space re-syncs (best-effort).
    const spaceId =
      updatedProject?.spaceId ??
      useSpaceStore.getState().getProjectMeta(projectId)?.spaceId;
    if (spaceId) {
      void proxyUpdateSpaceProject(spaceId, projectId, {
        metadata: { modelSelection },
      }).catch((error) => {
        console.warn(
          `Failed to persist model selection for project ${projectId}:`,
          error
        );
      });
    }
  },

  getProjectModel: (projectId: string | null) => {
    if (!projectId) {
      return null;
    }

    const { projects } = get();
    const runtimeSelection = projects[projectId]?.metadata?.modelSelection;
    if (runtimeSelection) {
      return runtimeSelection;
    }

    // Runtime store is not persisted; fall back to the space meta, which is
    // persisted locally and hydrated from the server.
    return (
      useSpaceStore.getState().getProjectMeta(projectId)?.metadata
        ?.modelSelection ?? null
    );
  },

  setProjectThinkingEffort: (
    projectId: string,
    effort: ThinkingEffortType | undefined
  ) => {
    const project = get().projects[projectId];
    if (!project) {
      console.warn(
        `Project ${projectId} not found for setting thinking effort`
      );
      return;
    }
    const previousEffort = get().getProjectThinkingEffortOverride(projectId);
    const nextEffort =
      effort === undefined ? null : normalizeThinkingEffort(effort);
    if (previousEffort === (nextEffort ?? undefined)) {
      return;
    }

    const capturedSpaceId =
      project.spaceId ??
      useSpaceStore.getState().getProjectMeta(projectId)?.spaceId;
    const applyLocalEffort = (localEffort: ThinkingEffortType | null) => {
      const currentPersistence =
        thinkingEffortPersistenceByProject.get(projectId);
      const currentProject = get().projects[projectId];
      const canReconcile = !currentPersistence?.removed;
      if (
        currentProject &&
        canReconcile &&
        (!capturedSpaceId || currentProject.spaceId === capturedSpaceId)
      ) {
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              metadata: {
                ...state.projects[projectId].metadata,
                thinkingEffort: localEffort,
              },
              updatedAt: Date.now(),
            },
          },
        }));
        const localProject = get().projects[projectId];
        if (localProject) {
          upsertSpaceProjectMetaFromProject(localProject);
        }
        return localProject ?? null;
      }

      const spaceStore = useSpaceStore.getState();
      const spaceProject = spaceStore.getProjectMeta(projectId);
      if (
        canReconcile &&
        capturedSpaceId &&
        spaceProject?.spaceId === capturedSpaceId
      ) {
        spaceStore.updateProjectMeta(projectId, {
          metadata: { thinkingEffort: localEffort },
        });
      }
      return null;
    };

    const observedEffort = previousEffort ?? null;
    let persistence = thinkingEffortPersistenceByProject.get(projectId);
    if (persistence?.removed) {
      // A runtime can also be restored outside createProject. Resume its
      // existing queue without promoting optimistic shell metadata to the
      // server-confirmed rollback baseline.
      persistence.removed = false;
    } else if (persistence && observedEffort !== persistence.optimisticEffort) {
      // A server hydration replaced the optimistic value while writes were
      // pending. Use that hydrated value as the rollback baseline.
      persistence.confirmedEffort = observedEffort;
    }

    const updatedProject = applyLocalEffort(nextEffort);
    const spaceId = updatedProject?.spaceId ?? capturedSpaceId;
    if (!spaceId) return;

    if (!persistence) {
      persistence = {
        confirmedEffort: observedEffort,
        optimisticEffort: observedEffort,
        latestRevision: 0,
        pendingCount: 0,
        removed: false,
        tail: Promise.resolve(),
      };
      thinkingEffortPersistenceByProject.set(projectId, persistence);
    }
    persistence.optimisticEffort = nextEffort;
    const revision = ++persistence.latestRevision;
    persistence.pendingCount += 1;
    const persistSelection = async () => {
      try {
        const persistedProject = await proxyUpdateSpaceProject(
          spaceId,
          projectId,
          {
            metadata: { thinkingEffort: nextEffort },
          }
        );
        if (persistedProject.updated_at) {
          const confirmedAt = timestampFromServer(
            persistedProject.updated_at,
            Number.NaN
          );
          if (Number.isFinite(confirmedAt)) {
            persistence.confirmedServerUpdatedAt = confirmedAt;
          }
        }
        persistence.confirmedEffort = nextEffort;
        if (revision === persistence.latestRevision) {
          persistence.optimisticEffort = nextEffort;
          applyLocalEffort(nextEffort);
        }
      } catch (error) {
        console.warn(
          `Failed to persist thinking effort for project ${projectId}:`,
          error
        );
        if (revision === persistence.latestRevision) {
          const currentEffort =
            get().getProjectThinkingEffortOverride(projectId) ?? null;
          if (currentEffort === nextEffort) {
            persistence.optimisticEffort = persistence.confirmedEffort;
            applyLocalEffort(persistence.confirmedEffort);
          } else {
            persistence.confirmedEffort = currentEffort;
            persistence.optimisticEffort = currentEffort;
          }
        }
      } finally {
        persistence.pendingCount -= 1;
        if (
          persistence.pendingCount === 0 &&
          (persistence.removed ||
            persistence.confirmedServerUpdatedAt === undefined) &&
          thinkingEffortPersistenceByProject.get(projectId) === persistence
        ) {
          thinkingEffortPersistenceByProject.delete(projectId);
        }
      }
    };
    persistence.tail = persistence.tail.then(
      persistSelection,
      persistSelection
    );
  },

  getProjectThinkingEffort: (projectId: string | null) => {
    if (!projectId) return ThinkingEffort.MEDIUM;
    return normalizeThinkingEffort(
      get().getProjectThinkingEffortOverride(projectId)
    );
  },

  getProjectThinkingEffortOverride: (projectId: string | null) => {
    if (!projectId) return undefined;
    const runtimeEffort = get().projects[projectId]?.metadata?.thinkingEffort;
    const persisted =
      runtimeEffort !== undefined
        ? runtimeEffort
        : useSpaceStore.getState().getProjectMeta(projectId)?.metadata
            ?.thinkingEffort;
    return persisted == null ? undefined : normalizeThinkingEffort(persisted);
  },

  setComposerThinkingEffort: (effort: ThinkingEffortType | undefined) => {
    const next =
      effort === undefined ? undefined : normalizeThinkingEffort(effort);
    if (get().composerThinkingEffort === next) return;
    set({ composerThinkingEffort: next });
  },

  getComposerThinkingEffort: () => {
    const effort = get().composerThinkingEffort;
    return effort === undefined ? undefined : normalizeThinkingEffort(effort);
  },

  isEmptyProject: (project: Project) => {
    return isEmptyProject(project);
  },
}));

export const useProjectStore = projectStore;

/**
 * Centralized live nav-lead subscription registry.
 *
 * For every Project that has an active chat store, subscribe to that chat
 * store and push the derived `SessionNavLeadPresentation` into
 * `navLeadByProjectId`. This makes the sidebar row icons react to live task
 * status changes (running → finished, etc.) without requiring each consumer
 * to subscribe to chat-store internals.
 *
 * The registry is reconciled whenever `projectStore.projects` changes (chat
 * store swap, project add/remove). Stale subscriptions are torn down.
 */
const navLeadSubscriptions = new Map<
  string,
  { chatStore: VanillaChatStore; unsubscribe: () => void }
>();

const navLeadsEqual = (
  a: SessionNavLeadPresentation | undefined,
  b: SessionNavLeadPresentation
) => !!a && a.kind === b.kind && a.Icon === b.Icon && a.spin === b.spin;

const pushLiveNavLead = (projectId: string, chatStore: VanillaChatStore) => {
  const chatState = chatStore.getState();
  const activeTask = chatState.activeTaskId
    ? chatState.tasks[chatState.activeTaskId]
    : undefined;
  if (!activeTask) return;
  const lead = getSessionNavLeadPresentation(activeTask);
  const current = projectStore.getState().navLeadByProjectId[projectId];
  if (navLeadsEqual(current, lead)) return;
  projectStore.getState().setProjectNavLead(projectId, lead);
};

const reconcileNavLeadSubscriptions = (state: ProjectStore) => {
  const seen = new Set<string>();
  for (const [projectId, project] of Object.entries(state.projects)) {
    const activeChatId = project.activeChatId;
    const chatStore = activeChatId
      ? project.chatStores[activeChatId]
      : Object.values(project.chatStores ?? {})[0];
    if (!chatStore) continue;
    seen.add(projectId);

    const existing = navLeadSubscriptions.get(projectId);
    if (existing?.chatStore === chatStore) continue;
    existing?.unsubscribe();

    pushLiveNavLead(projectId, chatStore);
    const unsubscribe = chatStore.subscribe(() =>
      pushLiveNavLead(projectId, chatStore)
    );
    navLeadSubscriptions.set(projectId, { chatStore, unsubscribe });
  }
  for (const [projectId, entry] of navLeadSubscriptions) {
    if (seen.has(projectId)) continue;
    entry.unsubscribe();
    navLeadSubscriptions.delete(projectId);
  }
};

projectStore.subscribe(reconcileNavLeadSubscriptions);
reconcileNavLeadSubscriptions(projectStore.getState());

if (typeof queueMicrotask === 'function') {
  queueMicrotask(() => {
    projectStore.getState().cleanupAutoCreatedEmptyProjects();
  });
}

export type {
  CreateProjectOptions,
  Project,
  ProjectMetadata,
  ProjectModelSelection,
  ProjectStore,
  TaskQueue,
};
