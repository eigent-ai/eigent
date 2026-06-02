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

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  isRemoteControlTargetReady,
  type RemoteControlProject,
  type RemoteControlSession,
  type RemoteControlSpace,
  type RemoteControlTarget,
} from '@web/api/remoteControl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Ban,
  Clock3,
  FolderPlus,
  Loader2,
  PanelLeftClose,
  Plus,
  RefreshCw,
  ShieldX,
  SkipForward,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

const REMOTE_SIDE_PANEL_TRANSITION = {
  type: 'spring',
  stiffness: 380,
  damping: 38,
  mass: 0.85,
} as const;

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function remoteStateLabel(
  session: RemoteControlSession | null,
  target: RemoteControlTarget | null
): string {
  if (!session) return '';
  if (session.status !== 'active') return 'Remote link inactive';
  if (session.bridge_status !== 'online') return 'Desktop offline';
  if (!isRemoteControlTargetReady(target)) return 'No active project';
  return 'Desktop online';
}

interface RemoteSidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: RemoteControlSession | null;
  target: RemoteControlTarget | null;
  space: RemoteControlSpace | null;
  projects: RemoteControlProject[];
  projectLoading: boolean;
  controlLoading: string | null;
  newProjectName: string;
  onNewProjectNameChange: (name: string) => void;
  onSelectProject: (project: RemoteControlProject) => void;
  onCreateProject: () => void;
  onSkip: () => void;
  onStop: () => void;
  onExtend: () => void;
  onRevoke: () => void;
  folderBacked: boolean;
  activeProject: RemoteControlProject | null;
  onRefresh?: () => void;
  onApply?: () => void;
  onDiscard?: () => void;
  ready: boolean;
  bridgeOnline: boolean;
}

export function RemoteSidePanel({
  open,
  onOpenChange,
  session,
  target,
  space,
  projects,
  projectLoading,
  controlLoading,
  newProjectName,
  onNewProjectNameChange,
  onSelectProject,
  onCreateProject,
  onSkip,
  onStop,
  onExtend,
  onRevoke,
  folderBacked,
  activeProject,
  onRefresh,
  onApply,
  onDiscard,
  ready,
  bridgeOnline,
}: RemoteSidePanelProps) {
  const reduceMotion = useReducedMotion();
  const panelTransition = reduceMotion
    ? { duration: 0 }
    : REMOTE_SIDE_PANEL_TRANSITION;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  const panel = (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.aside
          key="remote-side-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="remote-side-panel-title"
          className="border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default shadow-2xl left-2 top-2 bottom-2 w-72 max-w-72 gap-0 rounded-2xl p-0 sm:max-w-72 fixed z-50 flex flex-col overflow-hidden border border-solid"
          initial={reduceMotion ? false : { x: '-100%' }}
          animate={{ x: 0 }}
          exit={reduceMotion ? undefined : { x: '-100%' }}
          transition={panelTransition}
        >
          <h2 id="remote-side-panel-title" className="sr-only">
            Remote control panel
          </h2>

          <div className="min-h-0 flex h-full flex-col overflow-hidden">
            {/* Header */}
            <header className="h-12 px-4 text-body-sm font-semibold text-ds-text-neutral-default-default flex shrink-0 items-center justify-between">
              <span>Remote Control</span>
              <Button
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                buttonRadius="full"
                aria-label="Fold sidebar"
                onClick={() => onOpenChange(false)}
              >
                <PanelLeftClose className="h-4 w-4" aria-hidden />
              </Button>
            </header>

            {/* Content — no outer scroll; only project list scrolls */}
            <div className="min-h-0 flex flex-1 flex-col">
              {/* Section 1 — Connection (fixed) */}
              <div className="px-4 pb-4 shrink-0">
                {/* Status card */}
                <div className="rounded-xl border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default p-3 border border-solid">
                  <div className="gap-3 flex items-center">
                    <span
                      className={cn(
                        'h-9 w-9 rounded-lg flex shrink-0 items-center justify-center',
                        bridgeOnline
                          ? 'bg-ds-bg-status-completed-subtle-default text-ds-text-status-completed-default-default'
                          : 'bg-ds-bg-neutral-subtle-default text-ds-icon-neutral-muted-default'
                      )}
                    >
                      {bridgeOnline ? (
                        <Wifi className="h-4 w-4" />
                      ) : (
                        <WifiOff className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 gap-1 flex flex-col">
                      <span className="text-body-sm font-semibold text-ds-text-neutral-default-default">
                        {remoteStateLabel(session, target)}
                      </span>
                      {session?.expires_at && (
                        <span className="text-label-xs text-ds-text-neutral-muted-default">
                          Expires {formatDate(session.expires_at)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Control buttons */}
                <div className="mt-3 gap-2 flex flex-wrap">
                  <Button
                    variant="outline"
                    size="xs"
                    buttonContent="text"
                    buttonRadius="full"
                    disabled={!ready || !!controlLoading}
                    onClick={onSkip}
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                    Skip
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    buttonContent="text"
                    buttonRadius="full"
                    disabled={!ready || !!controlLoading}
                    onClick={onStop}
                  >
                    <Ban className="h-3.5 w-3.5" />
                    Stop
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    buttonContent="text"
                    buttonRadius="full"
                    disabled={!!controlLoading || session?.status !== 'active'}
                    onClick={onExtend}
                  >
                    <Clock3 className="h-3.5 w-3.5" />
                    Extend
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    buttonContent="text"
                    buttonRadius="full"
                    disabled={!!controlLoading || session?.status !== 'active'}
                    onClick={onRevoke}
                  >
                    <ShieldX className="h-3.5 w-3.5" />
                    Revoke
                  </Button>
                </div>
              </div>

              <div className="mx-4 border-ds-border-neutral-subtle-disabled shrink-0 border-t" />

              {/* Section 2 — Space (fixed) */}
              <div className="px-4 pt-4 gap-1 flex w-full shrink-0 flex-row items-center justify-between">
                <span className="text-body-sm font-semibold text-ds-text-neutral-default-default">
                  {space?.name || session?.space_name || 'Space'}
                </span>
                <span className="mt-0.5 text-label-xs text-ds-text-neutral-muted-default">
                  {projects.length} project(s)
                </span>
              </div>

              <div className="mx-4 border-ds-border-neutral-subtle-disabled shrink-0 border-t" />

              {/* Section 3 — Projects (scrollable list) */}
              <div className="min-h-0 px-4 pt-4 flex flex-1 flex-col">
                {/* Create project — fixed */}
                <form
                  className="mb-3 gap-2 flex shrink-0"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onCreateProject();
                  }}
                >
                  <input
                    value={newProjectName}
                    onChange={(e) => onNewProjectNameChange(e.target.value)}
                    placeholder="New project name…"
                    className="min-w-0 border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default px-3 py-1.5 text-body-sm focus:border-ds-border-neutral-default-default flex-1 rounded-full border border-solid transition outline-none"
                    disabled={!bridgeOnline || projectLoading}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    buttonContent="icon-only"
                    buttonRadius="full"
                    disabled={
                      !bridgeOnline || projectLoading || !newProjectName.trim()
                    }
                    aria-label="Create project"
                  >
                    {projectLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </Button>
                </form>

                {/* Project list — only this scrolls */}
                {projects.length > 0 ? (
                  <div className="scrollbar-always-visible min-h-0 gap-1.5 flex flex-1 flex-col overflow-y-auto">
                    {projects.map((project) => {
                      const selected = project.id === target?.project_id;
                      return (
                        <button
                          key={project.id}
                          type="button"
                          className={cn(
                            'rounded-xl px-3 py-2 text-body-sm w-full shrink-0 border border-solid text-left transition',
                            selected
                              ? 'border-ds-border-neutral-default-default bg-ds-bg-neutral-strong-default text-ds-text-inverse-default-default'
                              : 'border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-subtle-hover'
                          )}
                          disabled={!bridgeOnline || projectLoading}
                          onClick={() => {
                            onSelectProject(project);
                            onOpenChange(false);
                          }}
                        >
                          <span className="block truncate">
                            {project.name || project.id}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="gap-2 rounded-xl bg-ds-bg-neutral-subtle-default px-3 py-2 text-body-sm text-ds-text-neutral-muted-default flex items-center">
                    <FolderPlus className="h-4 w-4 shrink-0" />
                    Create a project to get started.
                  </div>
                )}
              </div>

              {/* Folder operations (fixed) */}
              {folderBacked && activeProject && (
                <>
                  <div className="mx-4 border-ds-border-neutral-subtle-disabled shrink-0 border-t" />
                  <div className="px-4 pb-4 pt-4 shrink-0">
                    <p className="mb-3 text-label-xs font-semibold tracking-wide text-ds-text-neutral-muted-default uppercase">
                      Folder ops
                    </p>
                    <div className="gap-2 flex flex-wrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        buttonContent="text"
                        buttonRadius="full"
                        disabled={!!controlLoading}
                        onClick={onRefresh}
                      >
                        <RefreshCw className="h-4 w-4" />
                        Refresh
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        buttonContent="text"
                        buttonRadius="full"
                        disabled={!!controlLoading}
                        onClick={onApply}
                      >
                        Apply
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        buttonContent="text"
                        buttonRadius="full"
                        disabled={!!controlLoading}
                        onClick={onDiscard}
                      >
                        Discard
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(panel, document.body);
}
