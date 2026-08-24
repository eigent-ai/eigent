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
      contentClassName="border-x-0 border-y-0 border-0 bg-ds-neutral-subtle-default shadow-ds-elevation-popover"
      commandClassName="bg-ds-neutral-subtle-default"
    >
      <DialogTitle className="sr-only">{t('dashboard.search')}</DialogTitle>
      <CommandInput
        placeholder={t('dashboard.command-search-placeholder', {
          defaultValue: 'Type a command or search…',
        })}
      />
      <CommandList>
        <CommandEmpty>{t('dashboard.no-results')}</CommandEmpty>
        <CommandGroup heading={t('dashboard.today', { defaultValue: 'Today' })}>
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
        className="no-drag flex h-6 w-60 items-center justify-center space-x-2 rounded-lg bg-ds-neutral-subtle-default"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4 text-ds-ink-muted-default"></Search>
        <span className="font-inter text-[10px] leading-4 text-ds-ink-muted-default">
          {t('dashboard.search-for-a-task-or-document')}
        </span>
      </div>
      <GlobalSearchDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
