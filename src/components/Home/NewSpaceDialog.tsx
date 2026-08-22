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

const SpaceProfileImportWizard = lazy(() =>
  import('@/components/SpaceProfile/SpaceProfileImportWizard').then(
    (module) => ({ default: module.SpaceProfileImportWizard })
  )
);
const AgentPluginImportWizard = lazy(() =>
  import('@/components/SpaceProfile/AgentPluginImportWizard').then(
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
  initialSpaceProfileHandle?: string;
  initialSpaceProfileProposalId?: string;
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
  initialPage = 'options',
  initialSpaceProfileHandle,
  initialSpaceProfileProposalId,
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
                  description="Connect local files already stored on this device."
                  busy={pendingOption === 'folder'}
                  disabled={pendingOption !== null}
                  onClick={() =>
                    void runCreationOption('folder', onUseLocalFolder)
                  }
                />
                <NewSpaceOption
                  icon={PackagePlus}
                  title="Import a Space profile"
                  description="Create a Space from a shared Space profile."
                  disabled={pendingOption !== null}
                  onClick={() => setPage('import-options')}
                />
              </div>
            </DialogContentSection>
          </>
        ) : page === 'import-options' ? (
          <>
            <DialogHeader
              title="Import a Space profile"
              subtitle="Add a Space profile name or convert an Agent Plugin into a Space profile."
              showBackButton
              onBackClick={() => setPage('options')}
            />
            <DialogContentSection>
              <div
                role="group"
                aria-label="Space profile import options"
                className={cn(
                  'grid gap-3',
                  canImportAgentPlugin ? 'grid-cols-2' : 'grid-cols-1'
                )}
              >
                <NewSpaceOption
                  icon={PackagePlus}
                  title="Add Space profile name"
                  description="Enter a shared Space profile name or handle and create a Space."
                  onClick={() => setPage('workspace-bundle')}
                />
                {canImportAgentPlugin ? (
                  <NewSpaceOption
                    icon={Puzzle}
                    title="Import Agent Plugin as Space profile"
                    description="Inspect a local Agent Plugin and convert it into a Space profile draft."
                    onClick={() => setPage('agent-plugin')}
                  />
                ) : null}
              </div>
            </DialogContentSection>
          </>
        ) : page === 'workspace-bundle' ? (
          <>
            <DialogHeader
              title="Import Space profile"
              subtitle="Enter a share handle to review the profile and create a Space."
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
                    <span className="sr-only">Loading Space profile form</span>
                  </div>
                }
              >
                <SpaceProfileImportWizard
                  initialHandle={initialSpaceProfileHandle}
                  initialProposalId={initialSpaceProfileProposalId}
                  showHeader={false}
                  onSpaceOpen={() => handleOpenChange(false)}
                />
              </Suspense>
            </DialogContentSection>
          </>
        ) : (
          <>
            <DialogHeader
              title="Import Agent Plugin as Space profile"
              subtitle="Inspect a local Agent Plugin and convert it into a Space profile draft."
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
                  initialTargetSpaceId={initialAgentPluginTargetSpaceId}
                  showHeader={false}
                  targetMode={agentPluginTargetMode}
                  onSpaceSettingsOpen={() => handleOpenChange(false)}
                />
              </Suspense>
            </DialogContentSection>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
