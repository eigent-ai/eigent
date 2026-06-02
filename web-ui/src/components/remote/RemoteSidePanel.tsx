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
  type RemoteControlProject,
  type RemoteControlSession,
  type RemoteControlSpace,
  type RemoteControlTarget,
} from '@web/api/remoteControl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Check,
  FolderPlus,
  MessageCircle,
  PanelLeftClose,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const REMOTE_SIDE_PANEL_TRANSITION = {
  type: 'spring',
  stiffness: 380,
  damping: 38,
  mass: 0.85,
} as const;

interface RemoteSidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: RemoteControlSession | null;
  target: RemoteControlTarget | null;
  space: RemoteControlSpace | null;
  projects: RemoteControlProject[];
  projectLoading: boolean;
  controlLoading: string | null;
  onSelectProject: (project: RemoteControlProject) => void;
  onCreateProject: (name: string) => void;
  folderBacked: boolean;
  activeProject: RemoteControlProject | null;
  onRefresh?: () => void;
  onApply?: () => void;
  onDiscard?: () => void;
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
  onSelectProject,
  onCreateProject,
  folderBacked,
  activeProject,
  onRefresh,
  onApply,
  onDiscard,
  bridgeOnline,
}: RemoteSidePanelProps) {
  const reduceMotion = useReducedMotion();
  const panelTransition = reduceMotion
    ? { duration: 0 }
    : REMOTE_SIDE_PANEL_TRANSITION;

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [draftName, setDraftName] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  const openCreateDialog = () => {
    setDraftName('');
    setCreateDialogOpen(true);
  };

  const submitCreate = () => {
    const name = draftName.trim();
    if (!name || projectLoading) return;
    setCreateDialogOpen(false);
    setDraftName('');
    onCreateProject(name);
  };

  const panel = (
    <>
      {open && (
        <div
          className="inset-0 fixed z-40"
          aria-hidden
          onClick={() => onOpenChange(false)}
        />
      )}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.aside
            key="remote-side-panel"
            role="dialog"
            aria-modal="false"
            aria-labelledby="remote-side-panel-title"
            className="border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default shadow-2xl left-2 top-2 bottom-2 w-72 max-w-72 gap-0 rounded-3xl p-0 sm:max-w-72 fixed z-50 flex flex-col overflow-hidden border border-solid"
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
              <header className="h-12 px-2 text-body-sm font-semibold text-ds-text-neutral-default-default gap-1 flex shrink-0 items-center">
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
                <span className="min-w-0 flex-1 truncate">
                  {space?.name || session?.space_name || 'Space'}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  buttonContent="icon-only"
                  buttonRadius="full"
                  aria-label="Create project"
                  disabled={!bridgeOnline || projectLoading}
                  onClick={openCreateDialog}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </header>

              {/* Content — no outer scroll; only project list scrolls */}
              <div className="min-h-0 flex flex-1 flex-col">
                {/* Project list */}
                <div className="min-h-0 pl-1 pt-2 flex flex-1 flex-col">
                  {projects.length > 0 ? (
                    <div className="scrollbar-always-visible min-h-0 gap-1.5 flex flex-1 flex-col overflow-y-auto">
                      {projects.map((project) => {
                        const selected = project.id === target?.project_id;
                        return (
                          <button
                            key={project.id}
                            type="button"
                            className={cn(
                              'rounded-xl px-3 py-2 text-body-sm gap-2 hover:bg-ds-bg-neutral-subtle-default flex w-full shrink-0 items-center border border-solid text-left transition [&_svg]:text-current',
                              selected
                                ? 'bg-ds-bg-neutral-subtle-default text-ds-text-neutral-default-default border-transparent'
                                : 'text-ds-text-neutral-muted-default border-transparent bg-transparent'
                            )}
                            disabled={!bridgeOnline || projectLoading}
                            onClick={() => {
                              onSelectProject(project);
                              onOpenChange(false);
                            }}
                          >
                            {selected ? (
                              <Check className="h-4 w-4 shrink-0" />
                            ) : (
                              <MessageCircle className="h-4 w-4 shrink-0" />
                            )}
                            <span className="truncate">
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

                {/* Folder operations */}
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

      {/* Create project dialog */}
      {createDialogOpen &&
        createPortal(
          <>
            <div
              className="inset-0 bg-dialog-overlay-scrim fixed z-[60]"
              aria-hidden
              onClick={() => setCreateDialogOpen(false)}
            />
            <div className="inset-0 p-4 pointer-events-none fixed z-[61] flex items-center justify-center">
              <div
                className="bg-ds-bg-neutral-default-default border-ds-border-neutral-subtle-default max-w-sm rounded-2xl p-6 shadow-2xl pointer-events-auto w-full border border-solid"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-base font-semibold text-ds-text-neutral-default-default mb-4">
                  New Project
                </h3>
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCreate();
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setCreateDialogOpen(false);
                    }
                  }}
                  placeholder="Project name…"
                  className="border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default px-3 py-2 text-body-sm focus:border-ds-border-neutral-default-default mb-4 w-full rounded-full border border-solid transition outline-none"
                />
                <div className="gap-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    buttonContent="text"
                    buttonRadius="full"
                    onClick={() => setCreateDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    buttonContent="text"
                    buttonRadius="full"
                    disabled={!draftName.trim() || projectLoading}
                    onClick={submitCreate}
                  >
                    Create
                  </Button>
                </div>
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(panel, document.body);
}
