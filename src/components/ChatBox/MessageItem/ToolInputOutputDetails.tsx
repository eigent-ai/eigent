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
  children,
  className,
}: ToolInputOutputDetailsProps) {
  if (!input && !output && children == null) return null;

  const labelClassName =
    'mb-1 block !text-label-xs font-medium uppercase tracking-wide text-ds-text-neutral-subtle-default';
  const surfaceClassName =
    'w-full rounded-md bg-ds-bg-neutral-muted-default p-2 opacity-60';

  return (
    <div className={`flex w-full flex-col gap-1.5 ${className || ''}`}>
      {input ? (
        <div className={surfaceClassName} data-tool-input>
          <span className={labelClassName}>{inputLabel}</span>
          <MarkDown
            content={input}
            enableTypewriter={false}
            pTextSize="!text-label-xs !font-normal text-ds-text-neutral-default-default"
          />
        </div>
      ) : null}
      {output ? (
        <div className={surfaceClassName} data-tool-output>
          <span className={labelClassName}>{outputLabel}</span>
          <MarkDown
            content={output}
            enableTypewriter={false}
            pTextSize="!text-label-xs !font-normal text-ds-text-neutral-default-default"
          />
        </div>
      ) : null}
      {children}
    </div>
  );
}
