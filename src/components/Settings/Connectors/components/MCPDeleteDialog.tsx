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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useState } from 'react';
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
  // Retain the last target so the content stays populated while the dialog
  // plays its close animation (target is cleared the moment `open` flips false).
  const [displayTarget, setDisplayTarget] = useState(target);
  if (target && target !== displayTarget) {
    setDisplayTarget(target);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) onCancel();
      }}
    >
      <DialogContent
        size="sm"
        overlayVariant="dimmed"
        showCloseButton={false}
        aria-busy={loading}
        onEscapeKeyDown={(event) => {
          if (loading) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (loading) event.preventDefault();
        }}
        className="gap-4 p-6"
      >
        <DialogTitle
          asChild
          className="text-ds-text-body-large text-ds-text-error-strong-default"
        >
          <span className="block">{t('setting.confirm-delete')}</span>
        </DialogTitle>
        <DialogDescription
          asChild
          className="text-ds-text-base text-ds-ink-default-default"
        >
          <span className="block">
            {t('setting.are-you-sure-you-want-to-delete')}{' '}
            <span className="font-bold">{displayTarget?.mcp_name}</span>?
          </span>
        </DialogDescription>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {t('setting.cancel')}
          </Button>
          <Button
            variant="primary"
            tone="error"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? t('setting.deleting') : t('setting.delete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
