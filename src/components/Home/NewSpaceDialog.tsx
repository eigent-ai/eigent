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
import { lazy, Suspense, useState } from 'react';
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

type NewSpaceDialogPage =
  | 'options'
  | 'import-options'
  | 'workspace-bundle'
  | 'agent-plugin';
type PendingOption = 'scratch' | 'folder' | null;

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
        'group flex min-h-40 min-w-0 flex-col items-start rounded-xl border border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default p-4 text-left transition-colors',
        'hover:bg-ds-bg-neutral-subtle-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-border-information-default-default',
        'disabled:opacity-60',
        busy ? 'cursor-wait' : 'disabled:cursor-not-allowed'
      )}
    >
      <span className="flex w-full items-center justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ds-bg-neutral-subtle-default text-ds-icon-neutral-default-default">
          {busy ? (
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <Icon className="h-5 w-5" aria-hidden />
          )}
        </span>
        <ArrowRight
          className="h-4 w-4 text-ds-icon-neutral-muted-default transition-colors group-hover:text-ds-icon-neutral-default-default"
          aria-hidden
        />
      </span>
      <span className="mt-5 block !text-body-md font-bold text-ds-text-neutral-default-default">
        {title}
      </span>
      <span className="mt-1 block !text-body-xs text-ds-text-neutral-muted-default">
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartFromScratch: () => Promise<boolean>;
  onUseLocalFolder: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState<NewSpaceDialogPage>('options');
  const [pendingOption, setPendingOption] = useState<PendingOption>(null);

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
              title="Create a new Space"
              subtitle="Choose how you want to set up this Space."
            />
            <DialogContentSection>
              <div
                role="group"
                aria-label="New Space options"
                className="grid grid-cols-3 gap-3"
              >
                <NewSpaceOption
                  icon={Plus}
                  title={t('layout.workspace-start-from-scratch')}
                  description="Create an empty Space and start with a clean workspace."
                  busy={pendingOption === 'scratch'}
                  disabled={pendingOption !== null}
                  onClick={() =>
                    void runCreationOption('scratch', onStartFromScratch)
                  }
                />
                <NewSpaceOption
                  icon={FolderOpen}
                  title={t('layout.workspace-use-local-folder')}
                  description="Connect a folder already stored on this device."
                  busy={pendingOption === 'folder'}
                  disabled={pendingOption !== null}
                  onClick={() =>
                    void runCreationOption('folder', onUseLocalFolder)
                  }
                />
                <NewSpaceOption
                  icon={PackagePlus}
                  title="Import from Workspace Bundle"
                  description="Create a Space from a shared Workspace Bundle."
                  disabled={pendingOption !== null}
                  onClick={() => setPage('import-options')}
                />
              </div>
            </DialogContentSection>
          </>
        ) : page === 'import-options' ? (
          <>
            <DialogHeader
              title="Import a Bundle"
              subtitle="Add a Workspace Bundle name or convert an Agent Plugin into a Bundle."
              showBackButton
              onBackClick={() => setPage('options')}
            />
            <DialogContentSection>
              <div
                role="group"
                aria-label="Bundle import options"
                className="grid grid-cols-2 gap-3"
              >
                <NewSpaceOption
                  icon={PackagePlus}
                  title="Add Workspace Bundle name"
                  description="Enter a shared Bundle name or handle and create a Space."
                  onClick={() => setPage('workspace-bundle')}
                />
                <NewSpaceOption
                  icon={Puzzle}
                  title="Import Agent Plugin as Bundle"
                  description="Inspect a local Agent Plugin and convert it into a Workspace Bundle draft."
                  onClick={() => setPage('agent-plugin')}
                />
              </div>
            </DialogContentSection>
          </>
        ) : page === 'workspace-bundle' ? (
          <>
            <DialogHeader
              title="Import Workspace Bundle"
              subtitle="Enter a share handle to review the bundle and create a Space."
              showBackButton
              onBackClick={() => setPage('import-options')}
            />
            <DialogContentSection className="scrollbar-always-visible overflow-y-auto p-5">
              <Suspense
                fallback={
                  <div
                    role="status"
                    className="flex min-h-32 items-center justify-center text-ds-icon-neutral-muted-default"
                  >
                    <LoaderCircle
                      className="h-5 w-5 animate-spin"
                      aria-hidden
                    />
                    <span className="sr-only">
                      Loading Workspace Bundle form
                    </span>
                  </div>
                }
              >
                <WorkspaceBundleInstallWizard
                  showHeader={false}
                  onWorkspaceOpen={() => handleOpenChange(false)}
                />
              </Suspense>
            </DialogContentSection>
          </>
        ) : (
          <>
            <DialogHeader
              title="Import Agent Plugin as Bundle"
              subtitle="Inspect a local Agent Plugin and convert it into a Workspace Bundle draft."
              showBackButton
              onBackClick={() => setPage('import-options')}
            />
            <DialogContentSection className="scrollbar-always-visible overflow-y-auto p-5">
              <Suspense
                fallback={
                  <div
                    role="status"
                    className="flex min-h-32 items-center justify-center text-ds-icon-neutral-muted-default"
                  >
                    <LoaderCircle
                      className="h-5 w-5 animate-spin"
                      aria-hidden
                    />
                    <span className="sr-only">Loading Agent Plugin form</span>
                  </div>
                }
              >
                <AgentPluginImportWizard
                  showHeader={false}
                  targetMode="create-space"
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
