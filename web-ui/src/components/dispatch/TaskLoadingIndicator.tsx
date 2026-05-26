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

import { formatSplittingElapsed } from '@/components/ChatBox/MessageItem/TokenUtils';
import { useTranslation } from 'react-i18next';

export function TaskLoadingIndicator({ elapsedMs }: { elapsedMs: number }) {
  const { t } = useTranslation();

  return (
    <div className="px-sm py-sm gap-3 flex w-full items-center">
      <span
        className="single-agent-text-shimmer text-body-sm font-medium"
        aria-live="polite"
      >
        {t('layout.web-task-working-in-progress', {
          defaultValue: 'Working in progress',
        })}
      </span>
      <span className="text-body-sm font-medium text-ds-text-neutral-muted-default tabular-nums">
        {formatSplittingElapsed(elapsedMs)}
      </span>
    </div>
  );
}
