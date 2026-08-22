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

import { MarkDown } from '@/components/WorkFlow/MarkDown';
import type { ReactNode } from 'react';

interface ToolInputOutputDetailsProps {
  input?: string;
  output?: string;
  inputLabel?: string;
  outputLabel?: string;
  showEmptyFields?: boolean;
  emptyInputText?: string;
  emptyOutputText?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * Shared vertical tool detail used by legacy-parity and event-native modes.
 * Callers must pass already-redacted display text; this component never reads
 * an event payload directly.
 */
export function ToolInputOutputDetails({
  input,
  output,
  inputLabel = 'Request',
  outputLabel = 'Response',
  showEmptyFields = false,
  emptyInputText = 'No request was recorded for this event.',
  emptyOutputText = 'No response was recorded for this event.',
  children,
  className,
}: ToolInputOutputDetailsProps) {
  if (!showEmptyFields && !input && !output && children == null) return null;

  const labelClassName =
    'mb-1 block !text-ds-text-meta font-medium uppercase tracking-wide text-ds-ink-subtle-default';
  const surfaceClassName =
    'w-full rounded-md bg-ds-neutral-muted-default p-2 opacity-60';

  return (
    <div className={`flex w-full flex-col gap-1.5 ${className || ''}`}>
      {input || showEmptyFields ? (
        <div
          className={surfaceClassName}
          data-tool-input
          data-tool-input-empty={input ? undefined : true}
        >
          <span className={labelClassName}>{inputLabel}</span>
          {input ? (
            <MarkDown
              content={input}
              enableTypewriter={false}
              pTextSize="!text-ds-text-meta !font-normal text-ds-ink-default-default"
            />
          ) : (
            <span className="block !text-ds-text-meta font-normal break-words whitespace-pre-wrap text-ds-ink-subtle-default">
              {emptyInputText}
            </span>
          )}
        </div>
      ) : null}
      {output || showEmptyFields ? (
        <div
          className={surfaceClassName}
          data-tool-output
          data-tool-output-empty={output ? undefined : true}
        >
          <span className={labelClassName}>{outputLabel}</span>
          {output ? (
            <MarkDown
              content={output}
              enableTypewriter={false}
              pTextSize="!text-ds-text-meta !font-normal text-ds-ink-default-default"
            />
          ) : (
            <span className="block !text-ds-text-meta font-normal break-words whitespace-pre-wrap text-ds-ink-subtle-default">
              {emptyOutputText}
            </span>
          )}
        </div>
      ) : null}
      {children}
    </div>
  );
}
