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

import AlertDialog from '@/components/ui/alertDialog';
import { useHost } from '@/host';
import {
  classifyDeleteSpaceFailure,
  deleteSpaceAndSessions,
  type DeleteSpaceFailure,
  type DeleteSpacePhase,
} from '@/lib/spaceDeletion';
import { useAuthStore } from '@/store/authStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const MESSAGE_KEY: Record<DeleteSpaceFailure, string> = {
  stop: 'layout.delete-space-stop-failed',
  cleanup: 'layout.delete-space-failed',
  'has-sessions': 'layout.delete-space-has-sessions',
  'has-bundles': 'layout.delete-space-has-bundles',
  'bundles-unchecked': 'layout.delete-space-bundles-unchecked',
};

const CONFIRM_KEY: Record<DeleteSpacePhase, string> = {
  idle: 'layout.delete',
  stopping: 'layout.delete-project-stopping',
  deleting: 'layout.deleting',
};

interface DeleteSpaceDialogProps {
  /** The Space to delete; `null` keeps the dialog closed. */
  spaceId: string | null;
  onClose: () => void;
}

/**
 * Confirms and runs a Space deletion, which also deletes every Session in
 * the Space. The dialog stays open while Sessions stop and are removed, and
 * explains a failure in place so the user can retry.
 */
export function DeleteSpaceDialog({
  spaceId,
  onClose,
}: DeleteSpaceDialogProps) {
  const { t } = useTranslation();
  const ipcRenderer = useHost()?.ipcRenderer;
  const [phase, setPhase] = useState<DeleteSpacePhase>('idle');
  const [failure, setFailure] = useState<DeleteSpaceFailure | null>(null);
  const identity = useRef<{
    email: string | null;
    userId: number | null;
  } | null>(null);
  const busy = phase !== 'idle';
  // Retrying can't help while a Workspace Bundle may come from this Space.
  const blocked = failure === 'has-bundles' || failure === 'bundles-unchecked';

  useEffect(() => {
    setFailure(null);
    setPhase('idle');
    if (!spaceId) return;
    // Cleanup must stay with the account that confirmed it.
    const { email, user_id: userId } = useAuthStore.getState();
    identity.current = { email, userId };
  }, [spaceId]);

  const confirm = useCallback(async () => {
    if (!spaceId || busy || blocked || !identity.current) return;
    setFailure(null);
    try {
      await deleteSpaceAndSessions(spaceId, {
        identity: identity.current,
        ipcRenderer,
        onPhase: setPhase,
      });
      onClose();
    } catch (error) {
      console.warn('[DeleteSpaceDialog] Failed to delete Space:', error);
      setFailure(classifyDeleteSpaceFailure(error));
      toast.error(t('layout.spaces-delete-failed'));
    } finally {
      setPhase('idle');
    }
  }, [blocked, busy, ipcRenderer, onClose, spaceId, t]);

  return (
    <AlertDialog
      isOpen={spaceId !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      onConfirm={() => void confirm()}
      title={t('layout.delete-space')}
      message={t(
        failure ? MESSAGE_KEY[failure] : 'layout.delete-space-confirmation'
      )}
      confirmText={t(
        failure && !busy && !blocked ? 'layout.retry' : CONFIRM_KEY[phase]
      )}
      closeOnConfirm={false}
      cancelText={t('layout.cancel')}
      confirmVariant="secondary"
      confirmTone="error"
      confirmDisabled={busy || blocked}
    />
  );
}
