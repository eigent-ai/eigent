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

import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { ResolvedRunModel } from '@/service/projectRunsApi';
import { useTranslation } from 'react-i18next';

export type { ResolvedRunModel } from '@/service/projectRunsApi';

/** Missing model receipts do not erase the last known model in this Session. */
export function previousRecordedRunModel(
  runIds: readonly string[],
  index: number,
  models: Readonly<Record<string, ResolvedRunModel | null>>
): ResolvedRunModel | undefined {
  for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
    const model = models[runIds[earlier]];
    if (model) return model;
  }
  return undefined;
}

export function ModelChangeDivider({
  previous,
  current,
  className,
}: {
  previous?: ResolvedRunModel | null;
  current?: ResolvedRunModel | null;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!previous || !current) return null;
  if (
    previous.platform === current.platform &&
    previous.type === current.type
  ) {
    return null;
  }

  const label = t('chat.timeline-model-changed', { model: current.type });
  return (
    <div
      className={cn('flex w-full items-center gap-3 py-1', className)}
      data-model-change-divider
      role="note"
    >
      <Separator className="min-w-0 flex-1" />
      <span
        className="min-w-0 truncate text-ds-text-meta font-normal text-ds-ink-muted-default"
        title={label}
      >
        {label}
      </span>
      <Separator className="min-w-0 flex-1" />
    </div>
  );
}
