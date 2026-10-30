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

import type { FileViewerOpenAction } from '@/components/Folder';
import { useIdeOpenActions } from '@/components/Folder/useIdeOpenActions';
import { useAppCommand } from '@/components/Layout/AppCommandProvider';
import { RIGHT_RAIL_CONTENT_WIDTH_CLASS } from '@/components/Layout/rightRail';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { Tag } from '@/components/ui/tag';
import { useWorkspaceComposerRequests } from '@/components/Workspace/composerRequests';
import { WorkspaceVersionHistoryDialog } from '@/components/Workspace/WorkspaceVersionHistoryDialog';
import { useHost } from '@/host';
import { pathBasename } from '@/lib/pathBasename';
import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import { cn, formatRelativeTime } from '@/lib/utils';
import { APP_COMMAND } from '@/shared/appCommands';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  selectSpaceOverviewLayout,
  useSpaceOverviewStore,
  type SpaceOverviewBoxId,
} from '@/store/spaceOverviewStore';
import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { useTriggerStore } from '@/store/triggerStore';
import { Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import {
  Cast,
  ChevronDown,
  Cloud,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GripVertical,
  Inbox,
  MessageCircle,
  Plus,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSpaceOverviewStats } from './useSpaceOverviewStats';

const BOX_CLASS =
  'flex min-w-0 list-none flex-col gap-ds-8 rounded-ds-card border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default px-ds-16 py-ds-12';
const DRAG_ELEVATION = { boxShadow: 'var(--ds-elevation-drag)' };

// A path under the user's home folder reads from `~`, so the panel shows
// where the folder is without the full machine path.
const HOME_PREFIX =
  /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[\\/]|$)/;

const homeRelativePath = (rootPath: string) =>
  rootPath.replace(HOME_PREFIX, '~');

/** A number while loaded, a dash when its service gave no answer. */
const countLabel = (value: number | null | undefined) =>
  value == null ? '—' : String(value);

interface BoxHeaderProps {
  icon: LucideIcon;
  title: string;
  /** A count or status beside the title, in the accent color. */
  count?: string;
  /** Makes the icon and title a link to the box's page. */
  onOpen?: () => void;
  openLabel?: string;
  action?: ReactNode;
}

/** `icon title count ——— action`, the first row of every box. */
function BoxHeader({
  icon,
  title,
  count,
  onOpen,
  openLabel,
  action,
}: BoxHeaderProps) {
  const lead = (
    <>
      <DsIcon
        icon={icon}
        className="shrink-0 text-ds-ink-muted-default"
        aria-hidden
      />
      <DsText
        as="span"
        role="base"
        weight="semibold"
        className="min-w-0 truncate group-hover/open:underline"
        title={title}
      >
        {title}
      </DsText>
      {count !== undefined ? (
        <DsText
          as="span"
          role="base"
          className="shrink-0 text-ds-accent-default-default tabular-nums"
        >
          {count}
        </DsText>
      ) : null}
    </>
  );
  return (
    <div className="flex min-h-ds-control-sm min-w-0 items-center gap-ds-8">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={openLabel}
          className={cn(
            'group/open flex min-w-0 flex-1 cursor-pointer items-center gap-ds-6 rounded-ds-compact-control text-left',
            DS_FOCUS_RING
          )}
        >
          {lead}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-ds-6">
          {lead}
        </span>
      )}
      {action ? <span className="-my-ds-4 shrink-0">{action}</span> : null}
    </div>
  );
}

function TextAction({
  label,
  ariaLabel,
  onClick,
  disabled,
}: {
  label: string;
  ariaLabel?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    // The negative margin lines the label up with the box's right content
    // edge, where the recent-file times end; the hover fill stays intact.
    <Button
      variant="ghost"
      size="sm"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="-mr-[var(--ds-button-sm-padding-inline)]"
    >
      {label}
    </Button>
  );
}

/** `Open ▾`: opens the Space folder in the file manager or an editor. */
function OpenInMenu({
  label,
  ariaLabel,
  disabled,
  destinations,
}: {
  label: string;
  ariaLabel: string;
  disabled?: boolean;
  destinations: FileViewerOpenAction[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={ariaLabel}
          disabled={disabled}
          className="-mr-[var(--ds-button-sm-padding-inline)]"
        >
          {label}
          <DsIcon icon={ChevronDown} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {destinations.map((destination) => (
          <DropdownMenuItem
            key={destination.id}
            onSelect={destination.onSelect}
          >
            {destination.icon}
            {destination.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DetailText({ children }: { children: ReactNode }) {
  return (
    <DsText
      as="span"
      role="base"
      className="truncate text-ds-ink-muted-default"
    >
      {children}
    </DsText>
  );
}

interface EditableBoxProps {
  box: SpaceOverviewBoxId;
  name: string;
  hidden: boolean;
  reducedMotion: boolean;
  instructionsId: string;
  onKeyboardMove: (box: SpaceOverviewBoxId, delta: -1 | 1) => void;
  handleRef: (box: SpaceOverviewBoxId, node: HTMLButtonElement | null) => void;
  children: ReactNode;
}

/**
 * An edit-mode box: the same box as outside edit mode. Its grip sits just
 * outside on the left, in the panel's padding; the 24px handle runs on over
 * the box's empty left padding, so the box keeps its size.
 */
function EditableBox({
  box,
  name,
  hidden,
  reducedMotion,
  instructionsId,
  onKeyboardMove,
  handleRef,
  children,
}: EditableBoxProps) {
  const { t } = useTranslation();
  const dragControls = useDragControls();
  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    onKeyboardMove(box, event.key === 'ArrowUp' ? -1 : 1);
  };

  return (
    <Reorder.Item
      as="li"
      value={box}
      dragListener={false}
      dragControls={dragControls}
      whileDrag={DRAG_ELEVATION}
      transition={reducedMotion ? { duration: 0 } : undefined}
      aria-label={name}
      className={cn(BOX_CLASS, 'relative')}
      data-space-overview-box={box}
      data-hidden={hidden || undefined}
    >
      {/* A bare grip: the grab cursor is its only hover cue, with no button
          fill; the focus ring remains for the keyboard. */}
      <button
        ref={(node) => handleRef(box, node)}
        type="button"
        aria-label={t('layout.space-overview-reorder', { name })}
        aria-describedby={instructionsId}
        className={cn(
          'absolute top-ds-14 -left-ds-16 flex h-ds-control-xs w-ds-24 cursor-grab touch-none items-center rounded-ds-compact-control border-0 border-x-0 border-y-0 bg-transparent p-0 text-ds-ink-muted-default active:cursor-grabbing',
          DS_FOCUS_RING
        )}
        onPointerDown={(event) => dragControls.start(event)}
        onKeyDown={onHandleKeyDown}
      >
        <span className="flex w-ds-16 justify-center">
          <DsIcon icon={GripVertical} recipe="main-compact" aria-hidden />
        </span>
      </button>
      <div
        className={cn('flex min-w-0 flex-col gap-ds-8', hidden && 'opacity-50')}
      >
        {children}
      </div>
    </Reorder.Item>
  );
}

/**
 * Workspace page rail summarizing the active Space as one column of bento
 * boxes. Each box leads with `icon title count` and its action, then its
 * details. Edit, under the column, lets people reorder the boxes by the
 * handles on their left and hide or add each one; the layout is saved for
 * that Space.
 */
export function SpaceOverviewPanel() {
  const { t } = useTranslation();
  const host = useHost();
  const runCommand = useAppCommand();
  const reducedMotion = Boolean(useReducedMotion());
  const instructionsId = useId();
  const space = useSpaceStore((s) =>
    s.activeSpaceId ? (s.spaces[s.activeSpaceId] ?? null) : null
  );
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);
  const activeProjectId = useProjectRuntimeStore((s) => s.activeProjectId);
  const navLeadByProjectId = useProjectRuntimeStore(
    (s) => s.navLeadByProjectId
  );
  const remoteLinkCount = useTriggerStore(
    (s) => s.activeRemoteControlSessions.length
  );
  const requestOpenTriggerAddDialog = usePageTabStore(
    (s) => s.requestOpenTriggerAddDialog
  );
  const requestAttachFiles = useWorkspaceComposerRequests(
    (s) => s.requestAttachFiles
  );
  const { email, user_id: userId } = useAuthStore();
  const savedLayout = useSpaceOverviewStore(
    selectSpaceOverviewLayout(space?.id)
  );
  const saveLayout = useSpaceOverviewStore((s) => s.saveLayout);
  const [draft, setDraft] = useState<{
    spaceId: string;
    order: SpaceOverviewBoxId[];
    hidden: SpaceOverviewBoxId[];
  } | null>(null);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const handles = useRef(new Map<SpaceOverviewBoxId, HTMLButtonElement>());

  const sessionIds = useMemo(
    () =>
      getVisibleProjectMetasForSpace(projectsBySpaceId, space?.id).map(
        (project) => project.id
      ),
    [projectsBySpaceId, space?.id]
  );
  const stats = useSpaceOverviewStats(space, sessionIds, {
    email: email ?? null,
    userId: userId ?? null,
  });
  const isLocal = Boolean(
    space && isLocalWorkspaceSpace(space) && space.rootPath
  );
  const ideActions = useIdeOpenActions(isLocal ? (space?.rootPath ?? '') : '');
  // Version history exists only for folder Spaces.
  const isAvailable = useCallback(
    (box: SpaceOverviewBoxId) => box !== 'versionHistory' || isLocal,
    [isLocal]
  );

  const handleRef = useCallback(
    (box: SpaceOverviewBoxId, node: HTMLButtonElement | null) => {
      if (node) handles.current.set(box, node);
      else handles.current.delete(box);
    },
    []
  );

  if (!space) return null;
  // An edit started in another Space does not carry over.
  const editDraft = draft?.spaceId === space.id ? draft : null;
  const editing = editDraft !== null;
  const folderMissing = isLocal && space.status === 'disconnected';
  const runningSessions = sessionIds.filter(
    (id) => navLeadByProjectId[id]?.kind === 'running'
  ).length;
  const { files, automations, versionHistory } = stats;
  const availableOrder = savedLayout.order.filter(isAvailable);

  const boxNames: Record<SpaceOverviewBoxId, string> = {
    location: t('layout.space-overview-location'),
    files: t('layout.space-overview-files'),
    sessions: t('layout.space-overview-sessions'),
    automations: t('layout.space-overview-automations'),
    dispatch: t('layout.dispatch-tab', { defaultValue: 'Dispatch' }),
    versionHistory: t('layout.space-overview-version-history'),
  };

  const startEditing = () =>
    setDraft({
      spaceId: space.id,
      order: availableOrder,
      hidden: savedLayout.hiddenBoxes.filter(isAvailable),
    });
  const stopEditing = () => {
    setDraft(null);
    setAnnouncement('');
  };
  const saveEditing = () => {
    if (!editDraft) return;
    // Boxes unavailable for this Space keep their saved state at the end.
    const unavailable = savedLayout.order.filter((box) => !isAvailable(box));
    saveLayout(space.id, {
      order: [...editDraft.order, ...unavailable],
      hiddenBoxes: [
        ...editDraft.hidden,
        ...savedLayout.hiddenBoxes.filter((box) => !isAvailable(box)),
      ],
    });
    stopEditing();
  };
  const toggleHidden = (box: SpaceOverviewBoxId) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            hidden: current.hidden.includes(box)
              ? current.hidden.filter((id) => id !== box)
              : [...current.hidden, box],
          }
        : current
    );
  const moveWithKeyboard = (box: SpaceOverviewBoxId, delta: -1 | 1) => {
    if (!editDraft) return;
    const index = editDraft.order.indexOf(box);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= editDraft.order.length) return;
    const order = [...editDraft.order];
    [order[index], order[target]] = [order[target], order[index]];
    setDraft({ ...editDraft, order });
    setAnnouncement(
      t('layout.space-overview-moved', {
        name: boxNames[box],
        position: target + 1,
        total: order.length,
      })
    );
    // Reordering moves the row; keep the keyboard on its handle.
    requestAnimationFrame(() => handles.current.get(box)?.focus());
  };

  // The main process opens only paths inside a registered Space root.
  const registerSpaceRoot = async () => {
    if (space.rootPath)
      await host?.ipcRenderer?.invoke('set-local-file-preview-roots', [
        space.rootPath,
      ]);
  };
  const openFolder = async () => {
    if (!space.rootPath) return;
    try {
      await registerSpaceRoot();
      const result = await host?.ipcRenderer?.invoke(
        'reveal-local-path',
        space.rootPath
      );
      if (!result?.success)
        toast.error(result?.error || t('chat.failed-to-open-folder'));
    } catch (error) {
      console.error('Failed to open the Space folder:', error);
      toast.error(t('chat.failed-to-open-folder'));
    }
  };
  const platform = host?.electronAPI?.getPlatform?.();
  const openFolderDestinations: FileViewerOpenAction[] = [
    {
      id: 'file-manager',
      label:
        platform === 'darwin'
          ? t('folder.open-in-finder', { defaultValue: 'Open in Finder' })
          : platform === 'win32'
            ? t('folder.open-in-explorer', {
                defaultValue: 'Open in File Explorer',
              })
            : t('folder.open-in-folder', {
                defaultValue: 'Open in file manager',
              }),
      icon: <DsIcon icon={FolderOpen} aria-hidden />,
      onSelect: () => void openFolder(),
    },
    ...ideActions.map((action) => ({
      ...action,
      onSelect: () => {
        void registerSpaceRoot().then(action.onSelect, () =>
          toast.error(t('chat.failed-to-open-folder'))
        );
      },
    })),
  ];
  // Automations belong to a Session, as the sidebar's Automations entry
  // requires; without one there is nothing to add an automation to.
  const addAutomation = () => {
    if (!activeProjectId && sessionIds.length === 0) {
      toast.error(t('layout.workspace-select-project'));
      return;
    }
    requestOpenTriggerAddDialog();
  };
  const openPageLabel = (name: string) =>
    t('layout.space-overview-open-page', { name });

  /**
   * The content of one box. In edit mode `editControl` replaces the box's
   * action and its links stay inert, so the box keeps its full content.
   */
  const renderBox = (
    box: SpaceOverviewBoxId,
    editControl?: ReactNode
  ): ReactNode => {
    const name = boxNames[box];
    const live = editControl === undefined;
    const linkTo = (command: () => void) => (live ? command : undefined);
    const actionOr = (action: ReactNode) => (live ? action : editControl);
    switch (box) {
      case 'location':
        return (
          <>
            <BoxHeader
              icon={isLocal ? Folder : Cloud}
              title={space.rootPath ? pathBasename(space.rootPath) : space.name}
              action={actionOr(
                isLocal && host?.ipcRenderer ? (
                  <OpenInMenu
                    label={t('layout.space-overview-open')}
                    ariaLabel={t('layout.space-overview-open-folder')}
                    disabled={folderMissing}
                    destinations={openFolderDestinations}
                  />
                ) : (
                  <TextAction
                    label={t('layout.space-overview-open')}
                    ariaLabel={t('layout.space-overview-open-files')}
                    onClick={() => runCommand(APP_COMMAND.navigateFiles)}
                  />
                )
              )}
            />
            <span className="flex min-w-0 items-center gap-ds-8">
              {space.rootPath ? (
                <DsText
                  as="span"
                  role="base"
                  className="min-w-0 flex-1 truncate text-ds-ink-muted-default"
                  title={homeRelativePath(space.rootPath)}
                >
                  {homeRelativePath(space.rootPath)}
                </DsText>
              ) : (
                <span className="flex-1" />
              )}
              {folderMissing || !isLocal ? (
                <Tag
                  size="xs"
                  variant="primary"
                  tone={folderMissing ? 'warning' : 'neutral'}
                  emphasis="subtle"
                  className="shrink-0"
                  text={
                    folderMissing
                      ? t('layout.space-overview-folder-missing')
                      : t('layout.space-overview-cloud')
                  }
                />
              ) : null}
            </span>
          </>
        );
      case 'files':
        return (
          <>
            <BoxHeader
              icon={Inbox}
              title={name}
              count={countLabel(files?.count)}
              onOpen={linkTo(() => runCommand(APP_COMMAND.navigateFiles))}
              openLabel={openPageLabel(name)}
              action={actionOr(
                host?.electronAPI ? (
                  <TextAction
                    label={t('layout.space-overview-add-files')}
                    onClick={requestAttachFiles}
                  />
                ) : undefined
              )}
            />
            {files && files.recent.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-ds-2 p-0">
                {files.recent.map((file) => {
                  const row = (
                    <>
                      <DsIcon
                        icon={FileText}
                        className="shrink-0 text-ds-ink-muted-default"
                        aria-hidden
                      />
                      <DsText
                        as="span"
                        role="base"
                        className="min-w-0 flex-1 truncate"
                      >
                        {file.name}
                      </DsText>
                      {file.modifiedAt !== null ? (
                        <DsText
                          as="span"
                          role="meta"
                          className="shrink-0 text-ds-ink-muted-default"
                        >
                          {formatRelativeTime(
                            new Date(file.modifiedAt).toISOString()
                          )}
                        </DsText>
                      ) : null}
                    </>
                  );
                  const rowClass =
                    '-mx-ds-6 flex w-[calc(100%+var(--ds-ref-space-12))] min-w-0 items-center gap-ds-8 rounded-ds-menu-row px-ds-6 py-ds-4 text-left';
                  return (
                    <li key={file.relativePath}>
                      {live ? (
                        <button
                          type="button"
                          onClick={() => runCommand(APP_COMMAND.navigateFiles)}
                          title={file.relativePath}
                          className={cn(
                            rowClass,
                            'cursor-pointer transition-colors hover:bg-ds-neutral-default-default motion-reduce:transition-none',
                            DS_FOCUS_RING
                          )}
                        >
                          {row}
                        </button>
                      ) : (
                        <span className={rowClass}>{row}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : files ? (
              <DetailText>{t('layout.space-overview-no-files')}</DetailText>
            ) : null}
          </>
        );
      case 'sessions':
        return (
          <>
            <BoxHeader
              icon={MessageCircle}
              title={name}
              count={String(sessionIds.length)}
              action={live ? undefined : editControl}
            />
            {runningSessions > 0 ? (
              <DetailText>
                {t('layout.space-overview-sessions-running', {
                  count: runningSessions,
                })}
              </DetailText>
            ) : null}
          </>
        );
      case 'automations':
        return (
          <>
            <BoxHeader
              icon={Zap}
              title={name}
              count={countLabel(automations?.total)}
              onOpen={linkTo(() => runCommand(APP_COMMAND.navigateScheduled))}
              openLabel={openPageLabel(name)}
              action={actionOr(
                <TextAction
                  label={t('layout.space-overview-add')}
                  ariaLabel={t('layout.space-overview-add-automation')}
                  onClick={addAutomation}
                />
              )}
            />
            {automations && automations.total > 0 ? (
              <DetailText>
                {t('layout.space-overview-automations-active', {
                  count: automations.active,
                })}
              </DetailText>
            ) : null}
          </>
        );
      case 'dispatch':
        return (
          <BoxHeader
            icon={Cast}
            title={name}
            count={
              remoteLinkCount > 0
                ? t('layout.space-overview-remote-on')
                : t('layout.space-overview-remote-off')
            }
            action={actionOr(
              <TextAction
                label={t('layout.space-overview-open')}
                ariaLabel={openPageLabel(name)}
                onClick={() => runCommand(APP_COMMAND.navigateDispatch)}
              />
            )}
          />
        );
      case 'versionHistory':
        return (
          <>
            <BoxHeader
              icon={GitBranch}
              title={
                versionHistory?.enabled && versionHistory.branch
                  ? versionHistory.branch
                  : name
              }
              action={actionOr(
                versionHistory?.enabled ? (
                  <TextAction
                    label={t('layout.space-overview-view-history')}
                    onClick={() => setVersionHistoryOpen(true)}
                  />
                ) : undefined
              )}
            />
            <DetailText>
              {!versionHistory
                ? '—'
                : !versionHistory.enabled
                  ? t('layout.space-overview-version-off')
                  : versionHistory.unsavedChanges > 0
                    ? t('layout.space-overview-unsaved-changes', {
                        count: versionHistory.unsavedChanges,
                        more: versionHistory.unsavedChangesTruncated ? '+' : '',
                      })
                    : t('layout.space-overview-all-saved')}
            </DetailText>
          </>
        );
    }
  };

  const visibleBoxes = availableOrder.filter(
    (box) => !savedLayout.hiddenBoxes.includes(box)
  );
  const visibilityControl = (box: SpaceOverviewBoxId, hidden: boolean) => {
    const label = t(
      hidden
        ? 'layout.space-overview-show-box'
        : 'layout.space-overview-hide-box',
      { name: boxNames[box] }
    );
    return (
      <Button
        variant="ghost"
        size="sm"
        buttonContent="icon-only"
        aria-label={label}
        title={label}
        onClick={() => toggleHidden(box)}
      >
        <DsIcon icon={hidden ? Plus : X} aria-hidden />
      </Button>
    );
  };

  return (
    <aside
      aria-label={t('layout.space-overview-label')}
      className={cn(
        'group/panel hidden min-h-0 shrink-0 flex-col lg:flex',
        RIGHT_RAIL_CONTENT_WIDTH_CLASS
      )}
      data-space-overview
      data-editing={editing || undefined}
      onKeyDown={(event) => {
        if (editing && event.key === 'Escape') stopEditing();
      }}
    >
      {/* 16px on both sides: the right is 8px plus the 8px scrollbar track.
          Edit-mode grips sit in the left padding; their hit area runs on over
          the box's own empty left padding. */}
      <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto py-ds-16 pr-ds-8 pl-ds-16">
        <span id={instructionsId} className="sr-only">
          {t('layout.space-overview-reorder-help')}
        </span>
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>

        {editDraft ? (
          <Reorder.Group
            as="ol"
            axis="y"
            values={editDraft.order}
            onReorder={(order) => setDraft({ ...editDraft, order })}
            className="m-0 flex list-none flex-col gap-ds-8 p-0"
          >
            {editDraft.order.map((box) => {
              const hidden = editDraft.hidden.includes(box);
              return (
                <EditableBox
                  key={box}
                  box={box}
                  name={boxNames[box]}
                  hidden={hidden}
                  reducedMotion={reducedMotion}
                  instructionsId={instructionsId}
                  onKeyboardMove={moveWithKeyboard}
                  handleRef={handleRef}
                >
                  {renderBox(box, visibilityControl(box, hidden))}
                </EditableBox>
              );
            })}
          </Reorder.Group>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-ds-8 p-0">
            {visibleBoxes.map((box) => (
              <li
                key={box}
                aria-label={boxNames[box]}
                className={BOX_CLASS}
                data-space-overview-box={box}
              >
                {renderBox(box)}
              </li>
            ))}
          </ol>
        )}

        <div className="flex min-h-ds-control-sm items-center justify-center gap-ds-4 pt-ds-8">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={stopEditing}>
                {t('layout.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={saveEditing}>
                {t('layout.save')}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={startEditing}
              className="opacity-0 transition-opacity group-focus-within/panel:opacity-100 group-hover/panel:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
            >
              {t('layout.edit')}
            </Button>
          )}
        </div>
      </div>

      <WorkspaceVersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        spaceId={space.id}
        email={email ?? null}
        userId={userId ?? null}
        actorId={userId == null ? email || 'local-user' : String(userId)}
      />
    </aside>
  );
}
