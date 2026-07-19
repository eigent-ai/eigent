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
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Confirming closes the window and terminates the running task, so this uses
// the shared AlertDialog (destructive confirm) for consistency with the
// end/delete-project confirmations.
export default function CloseNoticeDialog({ open, onOpenChange }: Props) {
  const host = useHost();
  const electronAPI = host?.electronAPI;
  const { t } = useTranslation();

  const onConfirm = useCallback(() => {
    electronAPI?.closeWindow(true);
  }, [electronAPI]);

  return (
    <AlertDialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      onConfirm={onConfirm}
      title={t('layout.close-notice')}
      message={t('layout.a-task-is-currently-running')}
      confirmText={t('layout.yes')}
      cancelText={t('layout.cancel')}
    />
  );
}
