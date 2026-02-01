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

import { Calculator, Calendar, Smile } from 'lucide-react';

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
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
const _items = [
  'Apple',
  'Banana',
  'Orange',
  'Grape',
  'Watermelon',
  'Pineapple',
  'Mango',
  'Blueberry',
];

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  return (
    <>
      <div
        className="bg-bg-surface-secondary no-drag flex h-6 w-60 items-center justify-center space-x-2 rounded-lg"
        onClick={() => setOpen(true)}
      >
        <Search className="text-text-secondary h-4 w-4"></Search>
        <span className="text-text-secondary font-inter text-[10px] leading-4">
          {t('dashboard.search-for-a-task-or-document')}
        </span>
      </div>
      <CommandDialog open={open} onOpenChange={setOpen}>
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
    </>
  );
}
