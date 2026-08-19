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
      } border-amber-300/70 dark:border-amber-700/60 dark:bg-amber-950/90 rounded-2xl border bg-amber-50 px-4 py-3 text-amber-950 shadow-sm dark:text-amber-100`}
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="block text-body-sm font-semibold">{title}</span>
            {attemptNumber != null && (
              <span className="shrink-0 text-label-xs font-normal opacity-60">
                #{attemptNumber}
              </span>
            )}
          </div>
          <span className="mt-1 block text-body-xs font-normal opacity-80">
            {description}
          </span>
          {!readOnly && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={onResume}
                disabled={action !== null}
                className="text-white inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-900 px-3 text-xs font-medium disabled:opacity-50 dark:bg-amber-100 dark:text-amber-950"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                <span>
                  {action === 'resuming' ? resumingLabel : resumeLabel}
                </span>
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={action !== null}
                className="dark:hover:bg-amber-900/50 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium opacity-75 hover:bg-amber-100 disabled:opacity-40"
              >
                <X className="size-3.5" aria-hidden="true" />
                <span>
                  {action === 'cancelling' ? cancellingLabel : cancelLabel}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
