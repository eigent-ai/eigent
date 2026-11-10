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

import { isWeb } from '@/client/platform';
import { SessionWindowNotice } from '@/components/SessionWindow/SessionWindowNotice';
import { Button } from '@/components/ui/button';
import {
  openSessionWindow,
  postSessionWindowMessage,
  type SessionWindowTarget,
} from '@/lib/sessionWindows';
import { useSessionWindowsStore } from '@/store/sessionWindowsStore';
import { AppWindow } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Main window, in place of a Session that is open in its own window: a
 * Session is shown in one place at a time.
 */
export function SessionInOwnWindow({
  target,
}: {
  target: SessionWindowTarget;
}) {
  const { t } = useTranslation();
  const inTab = isWeb();

  const bringBack = () => {
    postSessionWindowMessage({ type: 'close-window', ...target });
    useSessionWindowsStore.getState().markClosed(target.projectId);
  };

  return (
    <SessionWindowNotice
      icon={AppWindow}
      title={
        inTab
          ? t('layout.session-open-in-tab', {
              defaultValue: 'This session is open in another tab',
            })
          : t('layout.session-open-in-window', {
              defaultValue: 'This session is open in its own window',
            })
      }
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void openSessionWindow(target)}
          >
            {inTab
              ? t('layout.show-session-tab', { defaultValue: 'Show tab' })
              : t('layout.show-session-window', {
                  defaultValue: 'Show window',
                })}
          </Button>
          <Button variant="ghost" size="sm" onClick={bringBack}>
            {t('layout.bring-session-back', {
              defaultValue: 'Bring back here',
            })}
          </Button>
        </>
      }
    />
  );
}
