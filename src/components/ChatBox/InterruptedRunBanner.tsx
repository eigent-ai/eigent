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

import { Button } from '@/components/ui/button';
import { RotateCcw, TriangleAlert, X } from 'lucide-react';

export type InterruptedRunBannerAction = 'resuming' | 'cancelling' | null;

interface InterruptedRunBannerProps {
  title: string;
  description: string;
  attemptNumber?: number;
  action: InterruptedRunBannerAction;
  resumeLabel: string;
  resumingLabel: string;
  cancelLabel: string;
  cancellingLabel: string;
  onResume: () => void;
  onCancel: () => void;
  compact?: boolean;
  readOnly?: boolean;
}

export function InterruptedRunBanner({
  title,
  description,
  attemptNumber,
  action,
  resumeLabel,
  resumingLabel,
  cancelLabel,
  cancellingLabel,
  onResume,
  onCancel,
  compact = false,
  readOnly = false,
}: InterruptedRunBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`${
        compact ? 'mb-2' : 'mb-3'
      } rounded-2xl border border-x border-y border-solid border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default px-4 py-3 text-ds-text-warning-strong-default shadow-ds-elevation-control`}
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="block text-ds-text-base font-semibold">
              {title}
            </span>
            {attemptNumber != null && (
              <span className="shrink-0 text-ds-text-meta font-normal opacity-60">
                #{attemptNumber}
              </span>
            )}
          </div>
          <span className="mt-1 block text-ds-text-meta font-normal opacity-80">
            {description}
          </span>
          {!readOnly && (
            <div className="mt-3 flex items-center gap-2">
              <Button
                type="button"
                variant="primary"
                tone="warning"
                size="sm"
                onClick={onResume}
                disabled={action !== null}
              >
                <RotateCcw className="size-ds-icon-md" aria-hidden="true" />
                <span>
                  {action === 'resuming' ? resumingLabel : resumeLabel}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                tone="warning"
                size="sm"
                onClick={onCancel}
                disabled={action !== null}
              >
                <X className="size-ds-icon-md" aria-hidden="true" />
                <span>
                  {action === 'cancelling' ? cancellingLabel : cancelLabel}
                </span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
