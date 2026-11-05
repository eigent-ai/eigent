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
import { DsIcon } from '@/components/ui/ds-icon';
import { useHost } from '@/host';
import { saveRunHarborTask } from '@/service/workspaceGitApi';
import { useAuthStore } from '@/store/authStore';
import { Loader2, PackagePlus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useRunHarborTaskAvailability } from './useRunHarborTaskAvailability';

export { resetHarborTaskAvailabilityCache } from './useRunHarborTaskAvailability';

/** Why a Task could not be saved, by the backend's reason code. */
export const HARBOR_TASK_FAILURE_DESCRIPTION_KEYS: Record<string, string> = {
  unsupported_file_type: 'chat.harbor-task-unsupported-file-type',
  workspace_too_large: 'chat.harbor-task-workspace-too-large',
  unsupported_repository_layout: 'chat.harbor-task-unsupported-repository',
};

interface SaveAsHarborTaskButtonProps {
  runId?: string;
  projectId?: string | null;
  /** Availability is checked only once the Task has completed. */
  completed: boolean;
}

/**
 * Save a completed Task as a Harbor task folder on this computer. Hidden
 * unless the Task changed files that Eigent recorded in its Git history.
 */
export function SaveAsHarborTaskButton({
  runId,
  projectId,
  completed,
}: SaveAsHarborTaskButtonProps) {
  const { t } = useTranslation();
  const electronAPI = useHost()?.electronAPI;
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const { available, spaceId } = useRunHarborTaskAvailability({
    runId,
    projectId,
    completed,
  });
  const [saving, setSaving] = useState(false);

  const platform = electronAPI?.getPlatform?.();
  const revealLabel =
    platform === 'darwin'
      ? t('folder.show-in-finder', { defaultValue: 'Show in Finder' })
      : platform === 'win32'
        ? t('folder.show-in-explorer', {
            defaultValue: 'Show in File Explorer',
          })
        : t('folder.show-in-folder', { defaultValue: 'Show in folder' });

  const handleSave = useCallback(async () => {
    if (!runId || !spaceId || !email || saving) return;
    setSaving(true);
    try {
      const saved = await saveRunHarborTask(runId, spaceId, { email, userId });
      toast.success(t('chat.harbor-task-saved'), {
        description: saved.path,
        ...(electronAPI?.revealHarborTask
          ? {
              action: {
                label: revealLabel,
                onClick: () => {
                  void electronAPI.revealHarborTask(saved.path);
                },
              },
            }
          : {}),
      });
    } catch (error: any) {
      const descriptionKey =
        HARBOR_TASK_FAILURE_DESCRIPTION_KEYS[
          error?.response?.data?.detail?.code
        ];
      toast.error(t('chat.harbor-task-save-failed'), {
        description: descriptionKey ? t(descriptionKey) : undefined,
      });
    } finally {
      setSaving(false);
    }
  }, [electronAPI, email, revealLabel, runId, saving, spaceId, t, userId]);

  if (!available) return null;

  const label = t('chat.save-as-harbor-task');
  return (
    <Button
      type="button"
      onClick={handleSave}
      variant="ghost"
      size="sm"
      buttonContent="icon-only"
      aria-label={label}
      title={label}
      aria-busy={saving}
      disabled={saving}
    >
      {saving ? (
        <DsIcon icon={Loader2} className="animate-spin" />
      ) : (
        <DsIcon icon={PackagePlus} />
      )}
    </Button>
  );
}
