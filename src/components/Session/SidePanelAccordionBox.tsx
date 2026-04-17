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

import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';

export function SidePanelAccordionBox({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl bg-worker-surface-primary border-worker-border-default ease-in-out min-w-0 z-10 flex shrink-0 flex-col overflow-hidden border border-solid transition-all duration-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-surface-tertiary/50 gap-2 px-3 py-2.5 flex w-full shrink-0 items-center justify-between text-left transition-colors"
        aria-expanded={open}
      >
        <span className="text-text-heading text-body-sm font-semibold">
          {title}
        </span>
        <ChevronDown
          className={cn(
            'text-text-muted h-4 w-4 shrink-0 transition-transform duration-200',
            open ? 'rotate-0' : '-rotate-90'
          )}
          aria-hidden
        />
      </button>
      {open ? <div className="px-3 pb-3 w-full">{children}</div> : null}
    </div>
  );
}
