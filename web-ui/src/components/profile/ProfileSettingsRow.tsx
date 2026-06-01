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
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export function ProfileSettingsRow({
  label,
  trailing,
  onClick,
  className,
}: {
  label: string;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl bg-ds-bg-neutral-default-default px-3 py-3 text-left transition-colors hover:bg-ds-bg-neutral-default-hover',
        className
      )}
    >
      <span className="min-w-0 flex-1 text-body-sm font-medium text-ds-text-neutral-default-default">
        {label}
      </span>
      {trailing ? (
        <span className="max-w-[55%] truncate text-body-sm text-ds-text-neutral-muted-default">
          {trailing}
        </span>
      ) : null}
      <ChevronRight
        className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default"
        aria-hidden
      />
    </button>
  );
}
