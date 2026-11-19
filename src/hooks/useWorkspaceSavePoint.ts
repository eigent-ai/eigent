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

import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import {
  bootstrapWorkspaceGit,
  createWorkspaceSavePoint,
  fetchWorkspaceGitStatus,
  type WorkspaceGitStatus,
} from '@/service/workspaceGitApi';
import type { Space } from '@/store/spaceStore';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface UseWorkspaceSavePointInput {
  spaceId: string | null;
  space: Space | null;
  email: string | null;
  userId: string | number | null;
  shortcut?: boolean;
}

export function useWorkspaceSavePoint({
  spaceId,
  space,
  email,
  userId,
  shortcut = false,
}: UseWorkspaceSavePointInput) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<WorkspaceGitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enableConfirmOpen, setEnableConfirmOpen] = useState(false);
  const supported = Boolean(
    spaceId &&
    space &&
    email &&
    !spaceId.startsWith('legacy_') &&
    isLocalWorkspaceSpace(space)
  );
  const eigentOwnedSpace = space?.sourceType === 'blank';

  const loadStatus = useCallback(async () => {
    if (!supported || !spaceId || !email) {
      setStatus(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    try {
      const next = await fetchWorkspaceGitStatus(spaceId, { email, userId });
      setStatus(next);
      return next;
    } catch (error) {
      console.warn(
        '[WorkspaceSavePoint] Failed to load version status:',
        error
      );
      setStatus(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [email, spaceId, supported, userId]);

  useEffect(() => {
    setStatus(null);
  }, [spaceId]);

  const enable = useCallback(
    async (allowInit: boolean) => {
      if (!spaceId || !email || loading) return;
      setLoading(true);
      try {
        await bootstrapWorkspaceGit(
          spaceId,
          { email, userId },
          allowInit,
          eigentOwnedSpace
        );
        await loadStatus();
        toast.success(t('layout.workspace-version-enabled'));
      } catch (error) {
        console.warn(
          '[WorkspaceSavePoint] Failed to enable version history:',
          error
        );
        toast.error(t('layout.workspace-version-enable-failed'));
      } finally {
        setLoading(false);
      }
    },
    [email, eigentOwnedSpace, loadStatus, loading, spaceId, t, userId]
  );

  const requestEnable = useCallback(() => {
    if (status?.consent_required) {
      setEnableConfirmOpen(true);
      return;
    }
    void enable(false);
  }, [enable, status?.consent_required]);

  const save = useCallback(async () => {
    if (!spaceId || !email || saving) return;
    setSaving(true);
    try {
      const current = await fetchWorkspaceGitStatus(spaceId, {
        email,
        userId,
      });
      setStatus(current);
      if (!current.enabled) {
        if (current.consent_required) {
          setEnableConfirmOpen(true);
        } else {
          await enable(false);
        }
        return;
      }
      const pending = current.pending_managed_paths || [];
      const digest = current.diagnostics?.repo_state.digest;
      if (pending.length === 0 || !digest) {
        toast.info(t('layout.workspace-save-point-no-changes'));
        return;
      }
      const saved = await createWorkspaceSavePoint(
        spaceId,
        { email, userId },
        {
          operationRequestId: `user-save-${crypto.randomUUID()}`,
          expectedRepoStateDigest: digest,
          actorId: userId == null ? email : String(userId),
        }
      );
      toast.success(
        t('layout.workspace-save-point-saved', { count: saved.paths.length })
      );
      await loadStatus();
    } catch (error) {
      console.warn('[WorkspaceSavePoint] Failed to save progress:', error);
      toast.error(t('layout.workspace-save-point-failed'));
      await loadStatus();
    } finally {
      setSaving(false);
    }
  }, [email, enable, loadStatus, saving, spaceId, t, userId]);

  useEffect(() => {
    if (!supported || !shortcut) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 's'
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      void save();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save, shortcut, supported]);

  return {
    supported,
    status,
    loading,
    saving,
    enableConfirmOpen,
    setEnableConfirmOpen,
    loadStatus,
    enable,
    requestEnable,
    save,
  };
}
