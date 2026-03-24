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

import { useState } from 'react';

import { Calculator, Calendar, Search, Smile } from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { DialogTitle } from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';

export interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearchDialog({
  open,
  onOpenChange,
}: GlobalSearchDialogProps) {
  const { t } = useTranslation();
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      overlayClassName="backdrop-blur-none"
      contentClassName="border-0 bg-surface-primary shadow-perfect"
      commandClassName="bg-surface-primary"
    >
      <DialogTitle className="sr-only">{t('dashboard.search')}</DialogTitle>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>{t('dashboard.no-results')}</CommandEmpty>
        <CommandGroup heading="Today">
          <CommandItem>
            <Calendar />
            <span>{t('dashboard.calendar')}</span>
          </CommandItem>
          <CommandItem>
            <Smile />
            <span>{t('dashboard.search-emoji')}</span>
          </CommandItem>
          <CommandItem>
            <Calculator />
            <span>{t('dashboard.calculator')}</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
      </CommandList>
    </CommandDialog>
  );
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  return (
    <>
      <div
        className="bg-surface-primary no-drag h-6 w-60 space-x-2 rounded-lg flex items-center justify-center"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4 text-text-secondary"></Search>
        <span className="font-inter leading-4 text-text-secondary text-[10px]">
          {t('dashboard.search-for-a-task-or-document')}
        </span>
      </div>
      <GlobalSearchDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
