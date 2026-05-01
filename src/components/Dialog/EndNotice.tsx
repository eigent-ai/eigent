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
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: React.ReactNode;
  onConfirm: () => void;
  loading?: boolean;
}

export default function EndNoticeDialog({
  open,
  onOpenChange,
  trigger,
  onConfirm,
  loading = false,
}: Props) {
  const { t } = useTranslation();
  const onSubmit = useCallback(() => {
    onConfirm();
  }, [onConfirm]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="gap-0 !rounded-xl border-ds-border-neutral-strong-default !bg-ds-bg-neutral-strong-default p-0 shadow-sm sm:max-w-[600px] border">
        <DialogHeader className="!rounded-t-xl !bg-ds-bg-neutral-strong-default p-md justify-start">
          <DialogTitle className="m-0">{t('layout.end-project')}</DialogTitle>
        </DialogHeader>
        <div className="gap-md bg-ds-bg-neutral-strong-default p-md flex flex-col">
          {t('layout.ending-this-project-will-stop')}
        </div>
        <DialogFooter className="!rounded-b-xl bg-ds-bg-neutral-inverse-default p-md">
          <DialogClose asChild>
            <Button variant="ghost" size="md" disabled={loading}>
              {t('layout.cancel')}
            </Button>
          </DialogClose>
          <Button
            size="md"
            onClick={onSubmit}
            variant="caution"
            disabled={loading}
          >
            {t('layout.yes-end-project')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
