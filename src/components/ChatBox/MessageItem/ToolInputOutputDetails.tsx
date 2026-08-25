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
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface ToolInputOutputDetailsProps {
  description?: string;
  input?: string;
  output?: string;
  inputLabel?: string;
  outputLabel?: string;
  showEmptyFields?: boolean;
  showEmptyInput?: boolean;
  showEmptyOutput?: boolean;
  emptyInputText?: string;
  emptyOutputText?: string;
  children?: ReactNode;
  className?: string;
  appearance?: 'default' | 'code-scroll';
}

/**
 * Shared vertical tool detail used by legacy-parity and event-native modes.
 * Callers must pass already-redacted display text; this component never reads
 * an event payload directly.
 */
export function ToolInputOutputDetails({
  description,
  input,
  output,
  inputLabel,
  outputLabel,
  showEmptyFields = false,
  showEmptyInput = false,
  showEmptyOutput = false,
  emptyInputText,
  emptyOutputText,
  children,
  className,
  appearance = 'default',
}: ToolInputOutputDetailsProps) {
  const { t } = useTranslation();
  const resolvedInputLabel =
    inputLabel ?? t('chat.request', { defaultValue: 'Request' });
  const resolvedOutputLabel =
    outputLabel ?? t('chat.response', { defaultValue: 'Response' });
  const resolvedEmptyInputText =
    emptyInputText ??
    t('chat.no-request-recorded', {
      defaultValue: 'No request was recorded for this event.',
    });
  const resolvedEmptyOutputText =
    emptyOutputText ??
    t('chat.no-response-recorded', {
      defaultValue: 'No response was recorded for this event.',
    });
  const renderEmptyInput = showEmptyFields || showEmptyInput;
  const renderEmptyOutput = showEmptyFields || showEmptyOutput;
  if (
    !renderEmptyInput &&
    !renderEmptyOutput &&
    !description &&
    !input &&
    !output &&
    children == null
  )
    return null;

  if (appearance === 'code-scroll') {
    const codeSectionClassName =
      'min-w-0 rounded-ds-field bg-ds-neutral-subtle-default p-ds-10';
    const codeLabelClassName =
      'mb-ds-6 block !text-ds-text-meta font-medium text-ds-ink-muted-default';
    const codeValueClassName =
      'm-0 block !text-ds-text-meta font-normal break-words whitespace-pre-wrap text-ds-ink-default-default [overflow-wrap:anywhere]';

    const renderCodeSection = (
      kind: 'input' | 'output',
      value: string | undefined,
      label: string,
      emptyText: string,
      renderEmpty: boolean
    ) => {
      if (!value && !renderEmpty) return null;
      const dataAttributes =
        kind === 'input'
          ? {
              'data-tool-input': true,
              'data-tool-input-empty': value ? undefined : true,
            }
          : {
              'data-tool-output': true,
              'data-tool-output-empty': value ? undefined : true,
            };

      return (
        <section className={codeSectionClassName} {...dataAttributes}>
          <span className={codeLabelClassName}>{label}</span>
          <pre className={codeValueClassName}>
            <code className="font-code !text-ds-text-meta">
              {value || emptyText}
            </code>
          </pre>
        </section>
      );
    };

    return (
      <div
        className={cn(
          'scrollbar-always-visible flex max-h-[300px] w-full min-w-0 flex-col gap-ds-8 overflow-x-hidden overflow-y-auto rounded-ds-card border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-muted-default py-ds-8 pl-ds-8',
          className
        )}
        data-tool-details-appearance="code-scroll"
        data-tool-details-scroll
      >
        {description ? (
          <p
            className="m-0 !text-ds-text-meta font-normal break-words whitespace-pre-wrap text-ds-ink-muted-default"
            data-tool-description
          >
            {description}
          </p>
        ) : null}
        {renderCodeSection(
          'input',
          input,
          resolvedInputLabel,
          resolvedEmptyInputText,
          renderEmptyInput
        )}
        {renderCodeSection(
          'output',
          output,
          resolvedOutputLabel,
          resolvedEmptyOutputText,
          renderEmptyOutput
        )}
        {children}
      </div>
    );
  }

  const labelClassName =
    'mb-1 block !text-ds-text-meta font-medium uppercase tracking-wide text-ds-ink-subtle-default';
  const surfaceClassName =
    'w-full rounded-md bg-ds-neutral-muted-default p-2 opacity-60';

  return (
    <div className={`flex w-full flex-col gap-1.5 ${className || ''}`}>
      {input || renderEmptyInput ? (
        <div
          className={surfaceClassName}
          data-tool-input
          data-tool-input-empty={input ? undefined : true}
        >
          <span className={labelClassName}>{resolvedInputLabel}</span>
          {input ? (
            <MarkDown
              content={input}
              enableTypewriter={false}
              pTextSize="!text-ds-text-meta !font-normal text-ds-ink-default-default"
            />
          ) : (
            <span className="block !text-ds-text-meta font-normal break-words whitespace-pre-wrap text-ds-ink-subtle-default">
              {resolvedEmptyInputText}
            </span>
          )}
        </div>
      ) : null}
      {output || renderEmptyOutput ? (
        <div
          className={surfaceClassName}
          data-tool-output
          data-tool-output-empty={output ? undefined : true}
        >
          <span className={labelClassName}>{resolvedOutputLabel}</span>
          {output ? (
            <MarkDown
              content={output}
              enableTypewriter={false}
              pTextSize="!text-ds-text-meta !font-normal text-ds-ink-default-default"
            />
          ) : (
            <span className="block !text-ds-text-meta font-normal break-words whitespace-pre-wrap text-ds-ink-subtle-default">
              {resolvedEmptyOutputText}
            </span>
          )}
        </div>
      ) : null}
      {children}
    </div>
  );
}
