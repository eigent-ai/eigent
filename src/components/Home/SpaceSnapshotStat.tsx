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

import { Skeleton } from '@/components/ui/skeleton';
import type { ReactNode } from 'react';

export function SpaceSnapshotStat({
  icon,
  label,
  value,
  loading = false,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  loading?: boolean;
}) {
  return (
    <div data-space-stat={label} className="flex min-w-0 items-center gap-3">
      <div
        aria-hidden
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default text-ds-ink-default-default"
      >
        {icon}
      </div>
      <div className="min-w-0">
        <span className="block truncate !text-ds-text-meta font-semibold tracking-wide text-ds-ink-muted-default uppercase">
          {label}
        </span>
        {loading ? (
          <Skeleton
            data-space-stat-skeleton={label}
            className="mt-1 h-4 w-10"
          />
        ) : (
          <span
            className="mt-1 block truncate !text-ds-text-body-large font-semibold text-ds-ink-default-default"
            title={typeof value === 'string' ? value : undefined}
          >
            {value}
          </span>
        )}
      </div>
    </div>
  );
}
