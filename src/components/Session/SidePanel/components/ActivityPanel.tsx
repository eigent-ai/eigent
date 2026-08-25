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
  fetchConnectedProviders,
  type ConnectorProvider,
} from '@/api/connectors';
import { uploadFileToBrain } from '@/api/http';
import { isWeb } from '@/client/platform';
import { SidePanelAccordionBox } from '@/components/Session/SidePanel/components/AccordionBox';
import {
  buildProjectSessionPanelData,
  isProgressDone,
  mergeProjectFiles,
  type ProjectSessionPanelData,
  type SessionAgentItem,
  type SessionContextItem,
  type SessionEnvironmentItem,
  type SessionFileItem,
  type SessionProgressItem,
  type SessionResourceItem,
} from '@/components/Session/SidePanel/sections/buildProjectSessionPanelData';
import {
  CountPill,
  EarlierItems,
  ProgressCircle,
  SidePanelListRow,
} from '@/components/Session/SidePanel/sections/primitives';
import {
  arrangeSessionPanelItems,
  selectSessionPanelRuns,
  type SessionPanelScope,
} from '@/components/Session/SidePanel/sections/sessionPanelScope';
import {
  AgentInformationDialog,
  ToolCallsDialog,
} from '@/components/Session/SidePanel/sections/SessionSidePanelDialogs';
import { useProjectOutputFiles } from '@/components/Session/SidePanel/sections/useProjectOutputFiles';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { itemFadeMotion } from '@/components/ui/motion';
import { TooltipSimple } from '@/components/ui/tooltip';
import { AgentAvatar } from '@/components/Workspace/AgentAvatar';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useProjectEventRuntime } from '@/hooks/useProjectEventRuntime';
import {
  isProjectSessionRunActive,
  useProjectSessionOverview,
} from '@/hooks/useProjectSessionOverview';
import { useHost } from '@/host';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSkillsStore } from '@/store/skillsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  Globe,
  Hammer,
  MonitorCog,
  Plus,
  SquareTerminal,
  WandSparkles,
} from 'lucide-react';
import {
  Children,
  isValidElement,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const EMPTY_PANEL_DATA: ProjectSessionPanelData = {
  agents: [],
  contextItems: [],
  environments: [],
  files: [],
  progress: [],
  resources: [],
  toolCalls: [],
};
const PANEL_REBUILD_INTERVAL_MS = 32;

function useDeferredProjectSessionPanelData(
  projectId: string | null,
  runs: Parameters<typeof buildProjectSessionPanelData>[0],
  skills: Parameters<typeof buildProjectSessionPanelData>[1],
  connectors: Parameters<typeof buildProjectSessionPanelData>[2]
): ProjectSessionPanelData {
  const [state, setState] = useState<{
    data: ProjectSessionPanelData;
    projectId: string | null;
  }>({ data: EMPTY_PANEL_DATA, projectId });
  const latestInputRef = useRef({ connectors, projectId, runs, skills });
  const pendingRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(
    null
  );

  useEffect(() => {
    latestInputRef.current = { connectors, projectId, runs, skills };
    if (pendingRef.current !== null) return;
    pendingRef.current = globalThis.setTimeout(() => {
      pendingRef.current = null;
      const latest = latestInputRef.current;
      const data = buildProjectSessionPanelData(
        latest.runs,
        latest.skills,
        latest.connectors
      );
      startTransition(() => setState({ data, projectId: latest.projectId }));
    }, PANEL_REBUILD_INTERVAL_MS);
  }, [connectors, projectId, runs, skills]);

  useEffect(
    () => () => {
      if (pendingRef.current !== null) {
        globalThis.clearTimeout(pendingRef.current);
      }
    },
    []
  );

  return state.projectId === projectId ? state.data : EMPTY_PANEL_DATA;
}

function SimpleRows<T>({
  items,
  render,
}: {
  items: T[];
  render: (item: T) => ReactNode;
}) {
  const reducedMotion = Boolean(useReducedMotion());
  const rows = Children.toArray(items.map(render));

  return (
    <div className="flex min-w-0 flex-col">
      <AnimatePresence initial={false}>
        {rows.map((row, index) => (
          <motion.div
            {...itemFadeMotion(reducedMotion)}
            data-session-panel-item-motion
            key={
              isValidElement(row) && row.key !== null ? row.key : `row:${index}`
            }
          >
            {row}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function SectionList({ children }: { children: ReactNode }) {
  const sections = Children.toArray(children);
  const reducedMotion = Boolean(useReducedMotion());

  return (
    <div className="flex min-w-0 flex-col gap-1 py-1">
      <AnimatePresence initial={false}>
        {sections.map((section, index) => (
          <motion.div
            {...itemFadeMotion(reducedMotion)}
            className="flex min-w-0 flex-col gap-1"
            data-session-panel-section-motion
            key={
              isValidElement(section) && section.key !== null
                ? section.key
                : `section:${index}`
            }
          >
            {index > 0 ? (
              <div
                role="separator"
                className="h-px w-full shrink-0 bg-ds-border-neutral-subtle-disabled"
              />
            ) : null}
            {section}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function AgentCategorySection({
  title,
  items,
  scope,
  active,
  headerAction,
  onSelect,
}: {
  title: string;
  items: SessionAgentItem[];
  scope: SessionPanelScope;
  active: boolean;
  headerAction?: ReactNode;
  onSelect: (item: SessionAgentItem) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(active);
  const userControlledOpenRef = useRef(false);

  useEffect(() => {
    if (!userControlledOpenRef.current) setOpen(active);
  }, [active]);

  const { primary, earlier } = arrangeSessionPanelItems(items, scope);
  const rows = (agentItems: SessionAgentItem[]) => (
    <SimpleRows
      items={agentItems}
      render={(item) => (
        <SidePanelListRow
          key={item.id}
          leading={
            <AgentAvatar
              agentType={item.type}
              agentName={item.name}
              provider={item.provider}
              model={item.model}
              avatarSeed={item.avatarSeed}
              size="sm"
              className="rounded-sm"
            />
          }
          onClick={() => onSelect(item)}
        >
          {item.name ||
            (item.subagent
              ? t('layout.session-panel-subagent', {
                  defaultValue: 'Subagent',
                })
              : t('agents.agent', { defaultValue: 'Agent' }))}
        </SidePanelListRow>
      )}
    />
  );

  return (
    <SidePanelAccordionBox
      title={title}
      titleSuffix={<CountPill count={primary.length} />}
      headerAction={headerAction}
      open={open}
      onOpenChange={(nextOpen) => {
        userControlledOpenRef.current = true;
        setOpen(nextOpen);
      }}
    >
      {rows(primary)}
      <EarlierItems count={earlier.length}>{rows(earlier)}</EarlierItems>
    </SidePanelAccordionBox>
  );
}

function ProgressSection({
  items,
  scope,
  onSelect,
}: {
  items: SessionProgressItem[];
  scope: SessionPanelScope;
  onSelect: (item: SessionProgressItem) => void;
}) {
  const { t } = useTranslation();
  const { primary, earlier } = arrangeSessionPanelItems(items, scope, 'source');
  const rows = (progressItems: SessionProgressItem[]) => (
    <SimpleRows
      items={progressItems}
      render={(item) => (
        <SidePanelListRow
          key={item.key}
          leading={<ProgressCircle done={isProgressDone(item.task)} />}
          completed={isProgressDone(item.task)}
          onClick={() => onSelect(item)}
        >
          {item.task.content}
        </SidePanelListRow>
      )}
    />
  );

  return (
    <SidePanelAccordionBox
      title={t('layout.workforce-progress')}
      titleSuffix={<CountPill count={primary.length} />}
    >
      {rows(primary)}
      <EarlierItems count={earlier.length}>{rows(earlier)}</EarlierItems>
    </SidePanelAccordionBox>
  );
}

function ContextSubcategory({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: SessionContextItem[];
  onSelect: (item: SessionContextItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <SidePanelAccordionBox
      title={title}
      titleSuffix={<CountPill count={items.length} />}
      leading={
        <span
          className="size-1.5 shrink-0 rounded-full bg-ds-border-neutral-default-default"
          aria-hidden
        />
      }
      rowVariant="subcategory"
    >
      <SimpleRows
        items={items}
        render={(item) => (
          <SidePanelListRow
            key={`${item.category}:${item.id}`}
            leading={<ContextItemIcon item={item} />}
            onClick={() => onSelect(item)}
          >
            <span className="!text-ds-text-base">{item.label}</span>
          </SidePanelListRow>
        )}
      />
    </SidePanelAccordionBox>
  );
}

function ContextSection({
  items,
  scope,
  onSelect,
}: {
  items: SessionContextItem[];
  scope: SessionPanelScope;
  onSelect: (item: SessionContextItem) => void;
}) {
  const { t } = useTranslation();
  const { primary, earlier } = arrangeSessionPanelItems(items, scope);
  const earlierRows = (
    <SimpleRows
      items={earlier}
      render={(item) => (
        <SidePanelListRow
          key={`${item.category}:${item.id}`}
          leading={<ContextItemIcon item={item} />}
          onClick={() => onSelect(item)}
        >
          <span className="!text-ds-text-base">{item.label}</span>
        </SidePanelListRow>
      )}
    />
  );

  return (
    <SidePanelAccordionBox
      title={t('layout.execution-context')}
      titleSuffix={<CountPill count={primary.length} />}
    >
      <ContextSubcategory
        title={t('layout.session-panel-skills', {
          defaultValue: 'Skills',
        })}
        items={primary.filter((item) => item.category === 'skill')}
        onSelect={onSelect}
      />
      <ContextSubcategory
        title={t('layout.mcp-tools')}
        items={primary.filter((item) => item.category === 'connector')}
        onSelect={onSelect}
      />
      <EarlierItems count={earlier.length}>{earlierRows}</EarlierItems>
    </SidePanelAccordionBox>
  );
}

function ContextItemIcon({ item }: { item: SessionContextItem }) {
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => setIconFailed(false), [item.iconUrl]);

  if (item.iconUrl && !iconFailed) {
    return (
      <img
        src={item.iconUrl}
        alt=""
        className="h-4 w-4 object-contain"
        loading="lazy"
        decoding="async"
        onError={() => setIconFailed(true)}
      />
    );
  }
  if (item.icon) return item.icon;
  return item.category === 'skill' ? (
    <WandSparkles size={16} aria-hidden />
  ) : (
    <Hammer size={16} aria-hidden />
  );
}

function ResourcesSection({
  items,
  scope,
  onSelect,
}: {
  items: SessionResourceItem[];
  scope: SessionPanelScope;
  onSelect: (item: SessionResourceItem) => void;
}) {
  const { t } = useTranslation();
  const { primary, earlier } = arrangeSessionPanelItems(items, scope);
  const rows = (resources: SessionResourceItem[]) => (
    <SimpleRows
      items={resources}
      render={(item) => (
        <SidePanelListRow
          key={item.id}
          leading={
            item.kind === 'url' ? (
              <Globe size={16} aria-hidden />
            ) : (
              <FileText size={16} aria-hidden />
            )
          }
          trailing={
            item.kind === 'url' ? <ExternalLink size={14} aria-hidden /> : null
          }
          onClick={() => onSelect(item)}
        >
          {item.label}
        </SidePanelListRow>
      )}
    />
  );
  return (
    <SidePanelAccordionBox
      title={t('layout.session-panel-resources', {
        defaultValue: 'Resources',
      })}
      titleSuffix={<CountPill count={primary.length} />}
      defaultOpen={false}
    >
      {rows(primary)}
      <EarlierItems count={earlier.length}>{rows(earlier)}</EarlierItems>
    </SidePanelAccordionBox>
  );
}

function EnvironmentIcon({ label }: { label: string }) {
  if (label === 'Terminal') return <SquareTerminal size={16} aria-hidden />;
  if (label === 'Browser') return <Globe size={16} aria-hidden />;
  return <MonitorCog size={16} aria-hidden />;
}

function EnvironmentsSection({
  items,
  scope,
  onSelect,
}: {
  items: SessionEnvironmentItem[];
  scope: SessionPanelScope;
  onSelect: (item: SessionEnvironmentItem) => void;
}) {
  const { t } = useTranslation();
  const { primary, earlier } = arrangeSessionPanelItems(items, scope);
  const rows = (environments: SessionEnvironmentItem[]) => (
    <SimpleRows
      items={environments}
      render={(item) => (
        <SidePanelListRow
          key={item.id}
          leading={<EnvironmentIcon label={item.label} />}
          onClick={() => onSelect(item)}
        >
          {item.label}
        </SidePanelListRow>
      )}
    />
  );

  return (
    <SidePanelAccordionBox
      title={t('layout.session-panel-environments', {
        defaultValue: 'Environments',
      })}
      titleSuffix={<CountPill count={primary.length} />}
      defaultOpen={false}
    >
      {rows(primary)}
      <EarlierItems count={earlier.length}>{rows(earlier)}</EarlierItems>
    </SidePanelAccordionBox>
  );
}

function FilesSection({
  items,
  scope,
  onSelect,
  headerAction,
}: {
  items: SessionFileItem[];
  scope: SessionPanelScope;
  onSelect: (item: SessionFileItem) => void;
  headerAction?: ReactNode;
}) {
  const { t } = useTranslation();
  const { primary, earlier } = arrangeSessionPanelItems(items, scope);
  const rows = (files: SessionFileItem[]) => (
    <SimpleRows
      items={files}
      render={(item) => (
        <SidePanelListRow
          key={item.id}
          leading={<FileText size={16} aria-hidden />}
          trailing={
            !item.previewable ? (
              <span className="text-ds-text-meta text-ds-ink-muted-default">
                {t('layout.session-panel-file-unavailable', {
                  defaultValue: 'Preview unavailable',
                })}
              </span>
            ) : null
          }
          onClick={item.previewable ? () => onSelect(item) : undefined}
        >
          {item.file.name || item.file.path}
        </SidePanelListRow>
      )}
    />
  );
  return (
    <SidePanelAccordionBox
      title={t('layout.session-panel-files', {
        defaultValue: 'Files',
      })}
      titleSuffix={<CountPill count={primary.length} />}
      headerAction={headerAction}
    >
      {items.length === 0 ? (
        <div className="px-3 py-3 text-ds-text-base text-ds-ink-muted-default">
          {t('layout.session-panel-files-empty', {
            defaultValue: 'No output files yet.',
          })}
        </div>
      ) : (
        <>
          {rows(primary)}
          <EarlierItems count={earlier.length}>{rows(earlier)}</EarlierItems>
        </>
      )}
    </SidePanelAccordionBox>
  );
}

export function SessionActivityPanel({
  agentHeaderAction,
  scope,
}: {
  agentHeaderAction?: ReactNode;
  scope: SessionPanelScope;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const { chatStore } = useChatStoreAdapter();
  const projectStore = useProjectRuntimeStore();
  const { hydration, projectId } = useProjectEventRuntime();
  const overview = useProjectSessionOverview(projectId);
  const scopedChatStore =
    projectId && projectStore.activeProjectId === projectId ? chatStore : null;
  const activeTaskId = scopedChatStore?.activeTaskId ?? null;
  const composerTaskId =
    activeTaskId &&
    (!overview.currentRun || overview.currentRun.runId === activeTaskId)
      ? activeTaskId
      : null;
  const activeTask = activeTaskId
    ? scopedChatStore?.tasks[activeTaskId]
    : undefined;
  const workspaceRoot = useSpaceStore((state) => {
    if (!projectId) return null;
    const spaceId = state.projectIdIndex[projectId];
    return spaceId ? state.spaces[spaceId]?.rootPath || null : null;
  });
  const skills = useSkillsStore((state) => state.skills);
  const [connectors, setConnectors] = useState<ConnectorProvider[]>([]);
  const requestTaskBoxFocus = usePageTabStore(
    (state) => state.requestTaskBoxFocus
  );
  const setScrollToTurnRequest = usePageTabStore(
    (state) => state.setScrollToTurnRequest
  );
  const openFilePreview = usePageTabStore((state) => state.openFilePreview);
  const openBrowserPreview = usePageTabStore(
    (state) => state.openBrowserPreview
  );
  const [selectedAgent, setSelectedAgent] = useState<SessionAgentItem | null>(
    null
  );
  const [selectedContext, setSelectedContext] =
    useState<SessionContextItem | null>(null);
  const [addingFiles, setAddingFiles] = useState(false);
  const addFilesOperationRef = useRef(0);
  const attachmentScopeRef = useRef({
    projectId,
    chatStore: scopedChatStore,
    taskId: composerTaskId,
  });

  useEffect(() => {
    attachmentScopeRef.current = {
      projectId,
      chatStore: scopedChatStore,
      taskId: composerTaskId,
    };
  }, [composerTaskId, projectId, scopedChatStore]);

  useEffect(() => {
    addFilesOperationRef.current += 1;
    setSelectedAgent(null);
    setSelectedContext(null);
    setAddingFiles(false);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void fetchConnectedProviders()
      .then((providers) => {
        if (!cancelled) setConnectors(providers);
      })
      .catch(() => {
        if (!cancelled) setConnectors([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scopedRuns = useMemo(
    () => selectSessionPanelRuns(overview.runs, scope),
    [overview.runs, scope]
  );
  const panelData = useDeferredProjectSessionPanelData(
    projectId,
    scopedRuns,
    skills,
    connectors
  );
  const agents = useMemo(
    () => panelData.agents.filter((agent) => !agent.subagent),
    [panelData.agents]
  );
  const subagents = useMemo(
    () => panelData.agents.filter((agent) => agent.subagent),
    [panelData.agents]
  );
  const agentAccordionRunKey = `${projectId ?? 'no-project'}:${
    overview.currentRun?.runId ?? 'no-run'
  }`;
  const agentAccordionActive = overview.currentRun
    ? isProjectSessionRunActive(overview.currentRun.status)
    : false;
  const workspaceRelativePaths = useMemo(
    () =>
      panelData.files.flatMap((item) =>
        item.file.relativePath ? [item.file.relativePath] : []
      ),
    [panelData.files]
  );
  // Compatibility boundary: legacy ChatStore file-list changes still trigger
  // resolver refreshes, but mergeProjectFiles may only enrich durable rows.
  const projectFiles = useProjectOutputFiles(
    projectId,
    activeTask,
    activeTaskId,
    workspaceRoot,
    workspaceRelativePaths
  );
  const files = useMemo(
    () => mergeProjectFiles(panelData.files, projectFiles),
    [panelData.files, projectFiles]
  );

  const attachToRun = (
    target: {
      projectId: string;
      chatStore: NonNullable<typeof scopedChatStore>;
      taskId: string;
    },
    selectedFiles: File[]
  ) => {
    const current = attachmentScopeRef.current;
    if (
      selectedFiles.length === 0 ||
      current.projectId !== target.projectId ||
      current.chatStore !== target.chatStore ||
      current.taskId !== target.taskId
    ) {
      return;
    }
    // Read attaches at merge time so files added while the picker was open
    // are not clobbered.
    const existingFiles = target.chatStore.tasks[target.taskId]?.attaches ?? [];
    target.chatStore.setAttaches(target.taskId, [
      ...existingFiles,
      ...selectedFiles.filter(
        (selected) =>
          !existingFiles.some(
            (existing) => existing.filePath === selected.filePath
          )
      ),
    ]);
  };

  const addFiles = async () => {
    if (!projectId || !scopedChatStore || !composerTaskId || addingFiles) {
      return;
    }
    const target = {
      projectId,
      chatStore: scopedChatStore,
      taskId: composerTaskId,
    };
    const operationId = ++addFilesOperationRef.current;
    const isCurrentOperation = () => {
      const current = attachmentScopeRef.current;
      return (
        addFilesOperationRef.current === operationId &&
        current.projectId === target.projectId &&
        current.chatStore === target.chatStore &&
        current.taskId === target.taskId
      );
    };

    if (isWeb()) {
      // A dismissed file dialog has no dependable signal (`cancel` is not
      // fired everywhere), so the pending flag covers only the upload that
      // follows an actual selection.
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = async () => {
        const picked = Array.from(input.files ?? []);
        if (picked.length === 0 || !isCurrentOperation()) return;
        setAddingFiles(true);
        try {
          const uploads: File[] = [];
          for (const file of picked) {
            if (!isCurrentOperation()) break;
            try {
              const result = await uploadFileToBrain(file);
              if (!isCurrentOperation()) break;
              uploads.push({
                fileName: result.filename,
                filePath: result.file_id,
                fileId: result.file_id,
                source: 'upload',
              } as File);
            } catch (error) {
              console.error('Session file upload failed:', error);
              toast.error(
                t('layout.session-panel-upload-failed', {
                  defaultValue: 'Failed to upload {{name}}',
                  name: file.name,
                })
              );
            }
          }
          attachToRun(target, uploads);
        } finally {
          if (isCurrentOperation()) setAddingFiles(false);
        }
      };
      input.click();
      return;
    }

    setAddingFiles(true);
    try {
      const result = await host?.electronAPI?.selectFile({
        title: t('chat.select-file'),
        filters: [{ name: t('chat.all-files'), extensions: ['*'] }],
      });
      if (result?.success && Array.isArray(result.files)) {
        attachToRun(target, result.files);
      }
    } catch (error) {
      console.error('Select session files failed:', error);
    } finally {
      if (isCurrentOperation()) setAddingFiles(false);
    }
  };

  const addFilesLabel = t('layout.session-panel-attach-files', {
    defaultValue: 'Attach files to your next message',
  });
  const canAddFiles = Boolean(scopedChatStore && composerTaskId);
  const addFilesTooltip = canAddFiles
    ? addFilesLabel
    : t('layout.session-panel-add-files-unavailable', {
        defaultValue: 'You can only attach files to your next message.',
      });

  return (
    <>
      {/* No `flex-1` anywhere in this chain: each level takes its content
          height so the panel card hugs, and only shrinks (scrolling here) once
          the sections outgrow the column. */}
      <div className="relative flex min-h-0 w-full min-w-0 flex-col overflow-hidden">
        <div className="scrollbar-always-visible flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto">
          {projectId && hydration.status === 'error' ? (
            <div className="px-3 pt-3">
              <Alert tone="warning">
                <AlertTriangle className="size-4" aria-hidden />
                <AlertDescription className="flex flex-col items-start gap-2">
                  <span>
                    {t(
                      hydration.errorCode === 'unsupported'
                        ? 'layout.session-panel-history-unsupported'
                        : 'layout.session-panel-history-unavailable',
                      {
                        defaultValue:
                          hydration.errorCode === 'unsupported'
                            ? 'This backend does not support session history yet.'
                            : 'Some session history could not be loaded.',
                      }
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    buttonRadius="full"
                    onClick={hydration.retry}
                  >
                    {t('chat.timeline-history-retry', {
                      defaultValue: 'Try again',
                    })}
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : projectId &&
            (hydration.status === 'loading' ||
              hydration.status === 'retrying') ? (
            <div
              className="px-3 pt-3 text-ds-text-base text-ds-ink-muted-default"
              role="status"
            >
              {t(
                hydration.status === 'retrying'
                  ? 'chat.timeline-history-reconnecting'
                  : 'chat.timeline-history-loading'
              )}
            </div>
          ) : null}
          <SectionList>
            {agents.length > 0 ? (
              <AgentCategorySection
                key={`agents:${agentAccordionRunKey}`}
                title={t('layout.agents')}
                items={agents}
                scope={scope}
                active={agentAccordionActive}
                headerAction={agentHeaderAction}
                onSelect={setSelectedAgent}
              />
            ) : null}
            {subagents.length > 0 ? (
              <AgentCategorySection
                key={`subagents:${agentAccordionRunKey}`}
                title={t('agents.sub-agents', {
                  defaultValue: 'Subagents',
                })}
                items={subagents}
                scope={scope}
                active={agentAccordionActive}
                onSelect={setSelectedAgent}
              />
            ) : null}
            {panelData.progress.length > 0 ? (
              <ProgressSection
                key="progress"
                items={panelData.progress}
                scope={scope}
                onSelect={(item) => {
                  if (!projectId) return;
                  setScrollToTurnRequest({ projectId, taskId: item.taskId });
                  requestTaskBoxFocus(projectId, item.taskId);
                }}
              />
            ) : null}
            {panelData.contextItems.length > 0 ? (
              <ContextSection
                key="context"
                items={panelData.contextItems}
                scope={scope}
                onSelect={setSelectedContext}
              />
            ) : null}
            {panelData.environments.length > 0 ? (
              <EnvironmentsSection
                key="environments"
                items={panelData.environments}
                scope={scope}
                onSelect={(item) => {
                  if (!projectId) return;
                  setScrollToTurnRequest({
                    projectId,
                    taskId: item.taskId,
                  });
                }}
              />
            ) : null}
            {panelData.resources.length > 0 ? (
              <ResourcesSection
                key="resources"
                items={panelData.resources}
                scope={scope}
                onSelect={(item) => {
                  if (item.kind === 'url' && item.url) {
                    openBrowserPreview(item.url);
                  } else if (item.file) {
                    openFilePreview(item.file);
                  }
                }}
              />
            ) : null}
            {projectId ? (
              <FilesSection
                key="files"
                items={files}
                scope={scope}
                onSelect={(item) => openFilePreview(item.file)}
                headerAction={
                  <TooltipSimple
                    content={addFilesTooltip}
                    variant="instant"
                    side="bottom"
                  >
                    <span
                      className="inline-flex"
                      tabIndex={!canAddFiles ? 0 : undefined}
                      aria-label={!canAddFiles ? addFilesTooltip : undefined}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        buttonContent="icon-only"
                        buttonRadius="lg"
                        disabled={addingFiles || !canAddFiles}
                        aria-label={addFilesLabel}
                        onClick={() => void addFiles()}
                      >
                        <Plus className="size-4" aria-hidden />
                      </Button>
                    </span>
                  </TooltipSimple>
                }
              />
            ) : null}
          </SectionList>
          {panelData.agents.length === 0 &&
          panelData.progress.length === 0 &&
          panelData.contextItems.length === 0 &&
          panelData.environments.length === 0 &&
          panelData.resources.length === 0 &&
          files.length === 0 &&
          !projectId ? (
            <div className="px-3 py-6 text-center text-ds-text-base text-ds-ink-muted-default">
              {t('layout.session-activity-empty', {
                defaultValue:
                  'Session activity will appear here as work begins.',
              })}
            </div>
          ) : null}
        </div>
      </div>

      <AgentInformationDialog
        agent={selectedAgent}
        onOpenChange={(open) => {
          if (!open) setSelectedAgent(null);
        }}
      />
      <ToolCallsDialog
        item={selectedContext}
        onOpenChange={(open) => {
          if (!open) setSelectedContext(null);
        }}
      />
    </>
  );
}
