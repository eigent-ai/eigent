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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function Trigger() {
  const { t } = useTranslation();
  // const { history_type, setHistoryType } = useGlobalStore();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const confirmDelete = () => {
    setDeleteModalOpen(false);
  };

  return (
    <div className="mx-auto flex h-full max-w-[900px] flex-col">
      {/* alert dialog */}
      <AlertDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title={t('layout.delete-task')}
        message={t('layout.delete-task-confirmation')}
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
      />
      <div className="flex items-center justify-between px-6 py-4">
        <div className="text-2xl font-bold leading-4">
          {t('layout.triggers')}
        </div>
        <div className="flex items-center gap-md"></div>
      </div>
    </div>
  );
}
