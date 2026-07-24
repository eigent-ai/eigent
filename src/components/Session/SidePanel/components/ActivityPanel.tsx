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
  type SessionAgentItem,
  type SessionContextItem,
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
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useProjectSessionOverview } from '@/hooks/useProjectSessionOverview';
import { useHost } from '@/host';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSkillsStore } from '@/store/skillsStore';
import {
  Bot,
  Boxes,
  ExternalLink,
  FileText,
  Globe,
  Hammer,
  Plus,
  WandSparkles,
} from 'lucide-react';
import {
  Children,
  Fragment,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

function SimpleRows<T>({
  items,
  render,
}: {
  items: T[];
  render: (item: T) => ReactNode;
}) {
  return <div className="flex min-w-0 flex-col">{items.map(render)}</div>;
}

function SectionList({ children }: { children: ReactNode }) {
  const sections = Children.toArray(children);

  return (
    <div className="flex min-w-0 flex-col gap-1 py-1">
      {sections.map((section, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <div
              role="separator"
              className="h-px w-full shrink-0 bg-ds-border-neutral-subtle-disabled"
            />
          ) : null}
          {section}
        </Fragment>
      ))}
    </div>
  );
}

function AgentsSection({
  items,
  scope,
  headerAction,
  onSelect,
}: {
  items: SessionAgentItem[];
  scope: SessionPanelScope;
  headerAction?: ReactNode;
  onSelect: (item: SessionAgentItem) => void;
}) {
  const { t } = useTranslation();
  const { primary, earlier } = arrangeSessionPanelItems(items, scope);
  const rows = (agentItems: SessionAgentItem[]) => (
    <SimpleRows
      items={agentItems}
      render={(item) => (
        <SidePanelListRow
          key={item.id}
          leading={
            item.subagent ? (
              <Boxes size={16} aria-hidden />
            ) : (
              <Bot size={16} aria-hidden />
            )
          }
          onClick={() => onSelect(item)}
        >
          {item.name ||
            t('layout.session-panel-remote-subagent', {
              defaultValue: 'Remote subagent',
            })}
        </SidePanelListRow>
      )}
    />
  );

  return (
    <SidePanelAccordionBox
      title={t('layout.agents')}
      titleSuffix={<CountPill count={primary.length} />}
      headerAction={headerAction}
      defaultOpen={false}
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
  const { primary, earlier } = arrangeSessionPanelItems(items, scope);
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
  icon,
  items,
  onSelect,
}: {
  title: string;
  icon: ReactNode;
  items: SessionContextItem[];
  onSelect: (item: SessionContextItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <SidePanelAccordionBox
      title={title}
      titleSuffix={<CountPill count={items.length} />}
      leading={icon}
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
            <span className="!text-body-sm">{item.label}</span>
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
          <span className="!text-body-sm">{item.label}</span>
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
        icon={<WandSparkles size={16} aria-hidden />}
        items={primary.filter((item) => item.category === 'skill')}
        onSelect={onSelect}
      />
      <ContextSubcategory
        title={t('layout.mcp-tools')}
        icon={<Hammer size={16} aria-hidden />}
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
          onClick={() => onSelect(item)}
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
      {rows(primary)}
      <EarlierItems count={earlier.length}>{rows(earlier)}</EarlierItems>
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
  const projectStore = useProjectRuntimeStore();
  const projectId = projectStore.activeProjectId;
  const overview = useProjectSessionOverview(projectId);
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
  const panelData = useMemo(
    () => buildProjectSessionPanelData(scopedRuns, skills, connectors),
    [connectors, scopedRuns, skills]
  );
  const projectFiles = useProjectOutputFiles(
    projectId,
    overview.currentRun?.task,
    overview.currentRun?.taskId
  );
  const files = useMemo(
    () =>
      mergeProjectFiles(
        panelData.files,
        projectFiles,
        overview.currentRun?.taskId ?? '',
        overview.currentRun?.createdAt ?? 0,
        overview.currentRun?.updatedAt ?? 0
      ),
    [
      overview.currentRun?.taskId,
      overview.currentRun?.createdAt,
      overview.currentRun?.updatedAt,
      panelData.files,
      projectFiles,
    ]
  );

  const attachToRun = (
    run: NonNullable<typeof overview.currentRun>,
    selectedFiles: File[]
  ) => {
    if (selectedFiles.length === 0) return;
    // Read attaches at merge time so files added while the picker was open
    // are not clobbered.
    const state = run.chatStore.getState();
    const existingFiles = state.tasks[run.taskId]?.attaches ?? [];
    state.setAttaches(run.taskId, [
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
    const run = overview.currentRun;
    if (!run || addingFiles) return;

    if (isWeb()) {
      // A dismissed file dialog has no dependable signal (`cancel` is not
      // fired everywhere), so the pending flag covers only the upload that
      // follows an actual selection.
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = async () => {
        const picked = Array.from(input.files ?? []);
        if (picked.length === 0) return;
        setAddingFiles(true);
        try {
          const uploads: File[] = [];
          for (const file of picked) {
            try {
              const result = await uploadFileToBrain(file);
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
          attachToRun(run, uploads);
        } finally {
          setAddingFiles(false);
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
        attachToRun(run, result.files);
      }
    } catch (error) {
      console.error('Select session files failed:', error);
    } finally {
      setAddingFiles(false);
    }
  };

  const addFilesLabel = t('chat.input-attach-add-files-or-photos', {
    defaultValue: 'Add files',
  });

  return (
    <>
      {/* No `flex-1` anywhere in this chain: each level takes its content
          height so the panel card hugs, and only shrinks (scrolling here) once
          the sections outgrow the column. */}
      <div className="relative flex min-h-0 w-full min-w-0 flex-col overflow-hidden">
        <div className="scrollbar-always-visible flex min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden">
          <SectionList>
            {panelData.agents.length > 0 ? (
              <AgentsSection
                items={panelData.agents}
                scope={scope}
                headerAction={agentHeaderAction}
                onSelect={setSelectedAgent}
              />
            ) : null}
            {panelData.progress.length > 0 ? (
              <ProgressSection
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
                items={panelData.contextItems}
                scope={scope}
                onSelect={setSelectedContext}
              />
            ) : null}
            {panelData.resources.length > 0 ? (
              <ResourcesSection
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
            {files.length > 0 ? (
              <FilesSection
                items={files}
                scope={scope}
                onSelect={(item) => openFilePreview(item.file)}
                headerAction={
                  <TooltipSimple
                    content={addFilesLabel}
                    variant="instant"
                    side="bottom"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      buttonContent="icon-only"
                      buttonRadius="lg"
                      disabled={addingFiles || !overview.currentRun}
                      aria-label={addFilesLabel}
                      onClick={() => void addFiles()}
                    >
                      <Plus className="size-4" aria-hidden />
                    </Button>
                  </TooltipSimple>
                }
              />
            ) : null}
          </SectionList>
          {panelData.agents.length === 0 &&
          panelData.progress.length === 0 &&
          panelData.contextItems.length === 0 &&
          panelData.resources.length === 0 &&
          files.length === 0 ? (
            <div className="px-3 py-6 text-center text-body-sm text-ds-text-neutral-muted-default">
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
