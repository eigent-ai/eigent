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
        'gap-3 rounded-xl bg-ds-bg-neutral-default-default px-3 py-3 hover:bg-ds-bg-neutral-default-hover flex w-full items-center text-left transition-colors',
        className
      )}
    >
      <span className="min-w-0 text-body-sm font-medium text-ds-text-neutral-default-default flex-1">
        {label}
      </span>
      {trailing ? (
        <span className="text-body-sm text-ds-text-neutral-muted-default max-w-[55%] truncate">
          {trailing}
        </span>
      ) : null}
      <ChevronRight
        className="h-4 w-4 text-ds-icon-neutral-muted-default shrink-0"
        aria-hidden
      />
    </button>
  );
}
