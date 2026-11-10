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

import cursorIcon from '@/assets/icon/cursor.svg';
import vsCodeIcon from '@/assets/icon/vs-code.svg';
import { useHost } from '@/host';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { FileViewerOpenAction } from './index';

/** Build the exact-file IDE actions consistently for Files and Session previews. */
export function useIdeOpenActions(targetPath: string): FileViewerOpenAction[] {
  const { t } = useTranslation();
  const electronAPI = useHost()?.electronAPI;

  return useMemo(() => {
    if (!targetPath || !electronAPI?.openInIDE) return [];
    return (['cursor', 'vscode'] as const).map((ide) => ({
      id: ide,
      label: t(
        ide === 'cursor' ? 'chat.open-in-cursor' : 'chat.open-in-vscode'
      ),
      icon: (
        <img
          src={ide === 'cursor' ? cursorIcon : vsCodeIcon}
          alt=""
          className="size-ds-icon-md"
          aria-hidden
        />
      ),
      onSelect: () => {
        void electronAPI
          .openInIDE(targetPath, ide)
          .then((result: { success: boolean; error?: string }) => {
            if (!result.success) {
              toast.error(result.error || t('chat.failed-to-open-folder'));
              return;
            }
            // Load the store only after a successful user action. Keeping this
            // dependency out of module initialization avoids the auth/i18n
            // cycle for standalone preview consumers.
            void import('@/store/authStore').then(({ getAuthStore }) => {
              getAuthStore().setPreferredIDE(ide);
            });
          })
          .catch(() => toast.error(t('chat.failed-to-open-folder')));
      },
    }));
  }, [electronAPI, t, targetPath]);
}
