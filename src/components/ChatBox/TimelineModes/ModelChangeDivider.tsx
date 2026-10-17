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
import { useTranslation } from 'react-i18next';

/** The non-secret identity exposed by the durable Run read endpoints. */
export interface ResolvedRunModel {
  platform: string;
  type: string;
}

export function ModelChangeDivider({
  previous,
  current,
}: {
  previous?: ResolvedRunModel | null;
  current?: ResolvedRunModel | null;
}) {
  const { t } = useTranslation();
  if (!previous || !current) return null;
  if (
    previous.platform === current.platform &&
    previous.type === current.type
  ) {
    return null;
  }

  return (
    <div
      className="flex w-full items-center gap-3 py-1"
      data-model-change-divider
      role="note"
    >
      <Separator className="min-w-0 flex-1" />
      <span className="shrink-0 text-ds-text-meta font-normal text-ds-ink-muted-default">
        {t('chat.timeline-model-changed', { model: current.type })}
      </span>
      <Separator className="min-w-0 flex-1" />
    </div>
  );
}
