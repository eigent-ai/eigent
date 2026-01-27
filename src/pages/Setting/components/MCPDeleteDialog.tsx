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
import { useTranslation } from 'react-i18next';
import type { MCPUserItem } from './types';
interface MCPDeleteDialogProps {
  open: boolean;
  target: MCPUserItem | null;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}

export default function MCPDeleteDialog({
  open,
  target,
  onCancel,
  onConfirm,
  loading,
}: MCPDeleteDialogProps) {
  const { t } = useTranslation();
  if (!open || !target) return null;
  return (
    <div className="bg-black/30 fixed inset-0 z-30 flex items-center justify-center">
      <div className="min-w-[320px] max-w-[90vw] rounded-lg bg-white-100% p-6 shadow-lg">
        <div className="mb-2 font-bold text-red-600">
          {t('setting.confirm-delete')}
        </div>
        <div className="mb-4">
          {t('setting.are-you-sure-you-want-to-delete')}{' '}
          <b>{target.mcp_name}</b>?
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {t('setting.cancel')}
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={loading}>
            {loading ? t('setting.deleting') : t('setting.delete')}
          </Button>
        </div>
      </div>
    </div>
  );
}
