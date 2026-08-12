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
import { Trans } from 'react-i18next';

import { formatSplittingElapsed } from './TokenUtils';

export const AGENT_STEP_UNAVAILABLE_MESSAGE =
  'Agent step is not available at the moment.';

interface AgentStepUnavailableFallbackProps {
  className?: string;
  elapsedMs: number;
}

/**
 * Static, presentation-only receipt for a historical Run whose work-log event
 * is no longer available. It deliberately has no disclosure, retry, resume,
 * or human-input controls: a missing event cannot prove that any action is
 * still valid.
 */
export function AgentStepUnavailableFallback({
  className,
  elapsedMs,
}: AgentStepUnavailableFallbackProps) {
  const timeLabel = formatSplittingElapsed(elapsedMs);

  return (
    <section
      aria-label="Unavailable agent step"
      className={cn('my-2 flex w-full min-w-0 flex-col', className)}
      data-agent-step-unavailable
      role="status"
    >
      <div className="border-x-0 border-b border-t-0 border-solid border-ds-border-neutral-subtle-default px-0 py-2 text-body-sm font-medium text-ds-text-neutral-muted-default">
        <Trans
          i18nKey="chat.worked-for"
          values={{ time: timeLabel }}
          components={{
            elapsed: (
              <span className="tabular-nums text-ds-text-neutral-subtle-default" />
            ),
          }}
        />
      </div>
      <p className="m-0 py-3 text-label-sm text-ds-text-neutral-subtle-default">
        {AGENT_STEP_UNAVAILABLE_MESSAGE}
      </p>
    </section>
  );
}

export type { AgentStepUnavailableFallbackProps };
