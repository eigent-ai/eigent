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

import { Alert } from '@/components/ui/alert';
import AlertDialog from '@/components/ui/alertDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { DsText } from '@/components/ui/ds-text';
import { proxyFetchSpaceProjectOverlays } from '@/service/spaceApi';
import { fetchWorkspaceProjectWorkdir } from '@/service/workspaceApi';
import { getAuthStore } from '@/store/authStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type DeleteSessionPhase = 'idle' | 'stopping' | 'deleting';
export type DeleteSessionFailure = 'stop' | 'cleanup' | null;
type SessionWorkdir = 'none' | 'present' | 'pending-changes';

/** Offer workdir deletion only for an existing copy/worktree workdir. */
function useSessionWorkdir(projectId: string | null): SessionWorkdir {
  const [workdir, setWorkdir] = useState<SessionWorkdir>('none');
  useEffect(() => {
    setWorkdir('none');
    const meta = projectId
      ? useSpaceStore.getState().getProjectMeta(projectId)
      : undefined;
    const { email, user_id: userId } = getAuthStore();
    if (
      !projectId ||
      !meta?.spaceId ||
      !email ||
      (meta.workdirMode !== 'copy' && meta.workdirMode !== 'worktree')
    ) {
      return;
    }
    const spaceId = meta.spaceId;
    let alive = true;
    void (async () => {
      try {
        const { exists } = await fetchWorkspaceProjectWorkdir(
          spaceId,
          projectId,
          email,
          userId
        );
        if (!exists) return;
        // An unknown overlay state gets the stronger warning.
        const pendingChanges = await proxyFetchSpaceProjectOverlays(
          spaceId,
          projectId
        ).then(
          ({ overlays }) => overlays.length > 0,
          () => true
        );
        if (alive) setWorkdir(pendingChanges ? 'pending-changes' : 'present');
      } catch {
        // A workdir Brain cannot vouch for is never offered for deletion.
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);
  return workdir;
}

const MESSAGE_KEY: Record<Exclude<DeleteSessionFailure, null>, string> = {
  stop: 'layout.delete-project-stop-failed',
  cleanup: 'layout.delete-project-failed',
};

const CONFIRM_KEY: Record<DeleteSessionPhase, string> = {
  idle: 'layout.delete',
  stopping: 'layout.delete-project-stopping',
  deleting: 'layout.deleting',
};

export function DeleteSessionDialog({
  projectId,
  phase,
  failure,
  deleteWorkdir,
  onDeleteWorkdirChange,
  onClose,
  onConfirm,
}: {
  projectId: string | null;
  phase: DeleteSessionPhase;
  failure: DeleteSessionFailure;
  deleteWorkdir: boolean;
  onDeleteWorkdirChange: (checked: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const workdir = useSessionWorkdir(projectId);
  const busy = phase !== 'idle';

  return (
    <AlertDialog
      isOpen={projectId != null}
      onClose={() => {
        if (!busy) onClose();
      }}
      onConfirm={onConfirm}
      title={t('layout.delete-project')}
      confirmText={t(failure && !busy ? 'layout.retry' : CONFIRM_KEY[phase])}
      closeOnConfirm={false}
      cancelText={t('layout.cancel')}
      confirmVariant="secondary"
      confirmTone="error"
      confirmDisabled={busy}
    >
      <div className="flex flex-col gap-ds-stack-related">
        <DsText role="body-large" className="text-ds-ink-muted-default">
          {t(
            failure
              ? MESSAGE_KEY[failure]
              : 'layout.delete-project-confirmation'
          )}
        </DsText>
        {workdir !== 'none' && (
          <>
            <label className="flex items-center gap-ds-control-gap text-ds-ink-default-default">
              <Checkbox
                checked={deleteWorkdir}
                onCheckedChange={(checked) =>
                  onDeleteWorkdirChange(checked === true)
                }
                disabled={busy}
              />
              <DsText as="span" role="base">
                {t('layout.delete-project-workdir')}
              </DsText>
            </label>
            {workdir === 'pending-changes' ? (
              <Alert tone="warning">
                {t('layout.delete-project-workdir-pending-hint')}
              </Alert>
            ) : (
              <DsText role="meta" className="text-ds-ink-muted-default">
                {t('layout.delete-project-workdir-hint')}
              </DsText>
            )}
          </>
        )}
      </div>
    </AlertDialog>
  );
}
