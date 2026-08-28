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
import type { CloseExecutionClass, CloseIntent } from '@/shared/windowClose';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  intent: CloseIntent;
  executionClass: CloseExecutionClass;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export default function CloseNoticeDialog({
  open,
  intent,
  executionClass,
  onOpenChange,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const isQuit = intent === 'quit-app';
  const message =
    executionClass === 'canonical-durable'
      ? t(
          isQuit
            ? 'layout.close-durable-quit-message'
            : 'layout.close-durable-window-message'
        )
      : executionClass === 'unknown'
        ? t(
            isQuit
              ? 'layout.close-unknown-quit-message'
              : 'layout.close-unknown-window-message'
          )
        : t(
            isQuit
              ? 'layout.close-legacy-quit-message'
              : 'layout.close-legacy-window-message'
          );

  return (
    <AlertDialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      onConfirm={onConfirm}
      title={t(
        isQuit ? 'layout.shortcuts.quit' : 'layout.shortcuts.close-window'
      )}
      message={message}
      confirmText={t(
        isQuit ? 'layout.shortcuts.quit' : 'layout.shortcuts.close-window'
      )}
      cancelText={t('layout.cancel')}
    />
  );
}
