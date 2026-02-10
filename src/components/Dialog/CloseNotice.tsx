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

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: React.ReactNode;
}
export default function CloseNoticeDialog({
  open,
  onOpenChange,
  trigger,
}: Props) {
  const { t } = useTranslation();
  const onSubmit = useCallback(() => {
    window.electronAPI.closeWindow(true);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="gap-0 !rounded-xl border border-border-subtle-strong !bg-popup-surface p-0 shadow-sm sm:max-w-[600px]">
        <DialogHeader className="!rounded-t-xl !bg-popup-surface p-md">
          <DialogTitle className="m-0">{t('layout.close-notice')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-md bg-popup-bg p-md">
          {t('layout.a-task-is-currently-running')}
        </div>
        <DialogFooter className="!rounded-b-xl bg-white-100% p-md">
          <DialogClose asChild>
            <Button variant="ghost" size="md">
              {t('layout.cancel')}
            </Button>
          </DialogClose>
          <Button size="md" onClick={onSubmit} variant="primary">
            {t('layout.yes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
