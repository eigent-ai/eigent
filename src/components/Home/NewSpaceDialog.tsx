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

import { isDesktop } from '@/client/platform';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  ArrowRight,
  FolderOpen,
  LoaderCircle,
  PackagePlus,
  Plus,
  Puzzle,
  type LucideIcon,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const WorkspaceBundleInstallWizard = lazy(() =>
  import('@/components/WorkspaceBundle/WorkspaceBundleInstallWizard').then(
    (module) => ({ default: module.WorkspaceBundleInstallWizard })
  )
);
const AgentPluginImportWizard = lazy(() =>
  import('@/components/WorkspaceBundle/AgentPluginImportWizard').then(
    (module) => ({ default: module.AgentPluginImportWizard })
  )
);

export type NewSpaceDialogPage =
  'options' | 'import-options' | 'workspace-bundle' | 'agent-plugin';
type PendingOption = 'scratch' | 'folder' | null;

export interface NewSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartFromScratch: () => Promise<boolean>;
  onUseLocalFolder: () => Promise<boolean>;
  initialPage?: NewSpaceDialogPage;
  initialWorkspaceBundleHandle?: string;
  initialWorkspaceBundleProposalId?: string;
  initialAgentPluginTargetSpaceId?: string | null;
  agentPluginTargetMode?: 'existing' | 'create-space';
}

function NewSpaceOption({
  icon: Icon,
  title,
  description,
  busy,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group flex min-h-40 min-w-0 flex-col items-start rounded-xl border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default p-4 text-left transition-colors',
        'hover:bg-ds-neutral-subtle-default focus-visible:ring-2 focus-visible:ring-ds-border-information-default-default focus-visible:outline-none',
        'disabled:opacity-60',
        busy ? 'cursor-wait' : 'disabled:cursor-not-allowed'
      )}
    >
      <span className="flex w-full items-center justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ds-neutral-subtle-default text-ds-ink-default-default">
          {busy ? (
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <Icon className="h-5 w-5" aria-hidden />
          )}
        </span>
        <ArrowRight
          className="h-4 w-4 text-ds-ink-muted-default transition-colors group-hover:text-ds-ink-default-default"
          aria-hidden
        />
      </span>
      <span className="mt-5 block !text-ds-text-body-large font-bold text-ds-ink-default-default">
        {title}
      </span>
      <span className="mt-1 block !text-ds-text-meta text-ds-ink-muted-default">
        {description}
      </span>
    </button>
  );
}

export default function NewSpaceDialog({
  open,
  onOpenChange,
  onStartFromScratch,
  onUseLocalFolder,
  initialPage = 'options',
  initialWorkspaceBundleHandle,
  initialWorkspaceBundleProposalId,
  initialAgentPluginTargetSpaceId,
  agentPluginTargetMode = 'create-space',
}: NewSpaceDialogProps) {
  const { t } = useTranslation();
  const canImportAgentPlugin = isDesktop();
  const [page, setPage] = useState<NewSpaceDialogPage>(initialPage);
  const [pendingOption, setPendingOption] = useState<PendingOption>(null);

  useEffect(() => {
    if (open) setPage(initialPage);
  }, [initialPage, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPage('options');
      setPendingOption(null);
    }
    onOpenChange(nextOpen);
  };

  const runCreationOption = async (
    option: Exclude<PendingOption, null>,
    action: () => Promise<boolean>
  ) => {
    if (pendingOption) return;
    setPendingOption(option);
    try {
      if (await action()) handleOpenChange(false);
    } finally {
      setPendingOption(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg" overlayVariant="dimmed" className="max-h-[80vh]">
        {page === 'options' ? (
          <>
            <DialogHeader
              title={t('layout.create-new-space', {
                defaultValue: 'Create a new Space',
              })}
              subtitle={t('layout.create-new-space-description', {
                defaultValue: 'Choose how you want to set up this Space.',
              })}
            />
            <DialogContentSection>
              <div
                role="group"
                aria-label={t('layout.new-space-options', {
                  defaultValue: 'New Space options',
                })}
                className="grid grid-cols-3 gap-3"
              >
                <NewSpaceOption
                  icon={Plus}
                  title={t('layout.workspace-start-from-scratch')}
                  description={t(
                    'layout.workspace-start-from-scratch-description',
                    {
                      defaultValue:
                        'Create an empty Space and start with a clean workspace.',
                    }
                  )}
                  busy={pendingOption === 'scratch'}
                  disabled={pendingOption !== null}
                  onClick={() =>
                    void runCreationOption('scratch', onStartFromScratch)
                  }
                />
                <NewSpaceOption
                  icon={FolderOpen}
                  title={t('layout.workspace-use-local-folder')}
                  description={t(
                    'layout.workspace-use-local-folder-description',
                    {
                      defaultValue:
                        'Connect a folder already stored on this device.',
                    }
                  )}
                  busy={pendingOption === 'folder'}
                  disabled={pendingOption !== null}
                  onClick={() =>
                    void runCreationOption('folder', onUseLocalFolder)
                  }
                />
                <NewSpaceOption
                  icon={PackagePlus}
                  title={t('layout.workspace-import-from-bundle', {
                    defaultValue: 'Import from Workspace Bundle',
                  })}
                  description={t(
                    'layout.workspace-import-from-bundle-description',
                    {
                      defaultValue:
                        'Create a Space from a shared Workspace Bundle.',
                    }
                  )}
                  disabled={pendingOption !== null}
                  onClick={() => setPage('import-options')}
                />
              </div>
            </DialogContentSection>
          </>
        ) : page === 'import-options' ? (
          <>
            <DialogHeader
              title={t('layout.workspace-import-bundle', {
                defaultValue: 'Import a Bundle',
              })}
              subtitle={t('layout.workspace-import-bundle-description', {
                defaultValue:
                  'Add a Workspace Bundle name or convert an Agent Plugin into a Bundle.',
              })}
              showBackButton
              onBackClick={() => setPage('options')}
            />
            <DialogContentSection>
              <div
                role="group"
                aria-label={t('layout.workspace-bundle-import-options', {
                  defaultValue: 'Bundle import options',
                })}
                className={cn(
                  'grid gap-3',
                  canImportAgentPlugin ? 'grid-cols-2' : 'grid-cols-1'
                )}
              >
                <NewSpaceOption
                  icon={PackagePlus}
                  title={t('layout.workspace-add-bundle-name', {
                    defaultValue: 'Add Workspace Bundle name',
                  })}
                  description={t(
                    'layout.workspace-add-bundle-name-description',
                    {
                      defaultValue:
                        'Enter a shared Bundle name or handle and create a Space.',
                    }
                  )}
                  onClick={() => setPage('workspace-bundle')}
                />
                {canImportAgentPlugin ? (
                  <NewSpaceOption
                    icon={Puzzle}
                    title={t('layout.agent-plugin-import-as-bundle', {
                      defaultValue: 'Import Agent Plugin as Bundle',
                    })}
                    description={t(
                      'layout.agent-plugin-import-as-bundle-description',
                      {
                        defaultValue:
                          'Inspect a local Agent Plugin and convert it into a Workspace Bundle draft.',
                      }
                    )}
                    onClick={() => setPage('agent-plugin')}
                  />
                ) : null}
              </div>
            </DialogContentSection>
          </>
        ) : page === 'workspace-bundle' ? (
          <>
            <DialogHeader
              title={t('layout.workspace-import-workspace-bundle', {
                defaultValue: 'Import Workspace Bundle',
              })}
              subtitle={t(
                'layout.workspace-import-workspace-bundle-description',
                {
                  defaultValue:
                    'Enter a share handle to review the bundle and create a Space.',
                }
              )}
              showBackButton
              onBackClick={() => setPage('import-options')}
            />
            <DialogContentSection className="scrollbar-always-visible overflow-y-auto p-5">
              <Suspense
                fallback={
                  <div
                    role="status"
                    className="flex min-h-32 items-center justify-center text-ds-ink-muted-default"
                  >
                    <LoaderCircle
                      className="h-5 w-5 animate-spin"
                      aria-hidden
                    />
                    <span className="sr-only">
                      {t('layout.workspace-bundle-form-loading', {
                        defaultValue: 'Loading Workspace Bundle form',
                      })}
                    </span>
                  </div>
                }
              >
                <WorkspaceBundleInstallWizard
                  initialHandle={initialWorkspaceBundleHandle}
                  initialProposalId={initialWorkspaceBundleProposalId}
                  showHeader={false}
                  onWorkspaceOpen={() => handleOpenChange(false)}
                />
              </Suspense>
            </DialogContentSection>
          </>
        ) : (
          <>
            <DialogHeader
              title={t('layout.agent-plugin-import-as-bundle', {
                defaultValue: 'Import Agent Plugin as Bundle',
              })}
              subtitle={t('layout.agent-plugin-import-as-bundle-description', {
                defaultValue:
                  'Inspect a local Agent Plugin and convert it into a Workspace Bundle draft.',
              })}
              showBackButton
              onBackClick={() => setPage('import-options')}
            />
            <DialogContentSection className="scrollbar-always-visible overflow-y-auto p-5">
              <Suspense
                fallback={
                  <div
                    role="status"
                    className="flex min-h-32 items-center justify-center text-ds-ink-muted-default"
                  >
                    <LoaderCircle
                      className="h-5 w-5 animate-spin"
                      aria-hidden
                    />
                    <span className="sr-only">
                      {t('layout.agent-plugin-form-loading', {
                        defaultValue: 'Loading Agent Plugin form',
                      })}
                    </span>
                  </div>
                }
              >
                <AgentPluginImportWizard
                  initialTargetSpaceId={initialAgentPluginTargetSpaceId}
                  showHeader={false}
                  targetMode={agentPluginTargetMode}
                  onConfigurationOpen={() => handleOpenChange(false)}
                />
              </Suspense>
            </DialogContentSection>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
