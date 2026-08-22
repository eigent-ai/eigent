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

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { RepeatedToolCallGroupRow } from './activityGrouping';

interface RepeatedToolCallGroupProps {
  group: RepeatedToolCallGroupRow;
}

function displayStatus(status: string): string {
  return status.replaceAll('_', ' ');
}

function groupStatusLabel(
  group: RepeatedToolCallGroupRow,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const statuses = group.calls.map((call) => call.presentedNode.status);
  const completed = statuses.filter((status) => status === 'completed').length;
  const failed = statuses.filter((status) => status === 'failed').length;
  const cancelled = statuses.filter((status) => status === 'cancelled').length;
  const active = statuses.filter(
    (status) => status === 'pending' || status === 'running'
  ).length;

  if (failed > 0) return t('chat.repeated-tool-failed', { count: failed });
  if (active > 0) {
    return t('chat.repeated-tool-completed-progress', {
      completed,
      count: group.calls.length,
    });
  }
  if (cancelled > 0) {
    return t('chat.repeated-tool-cancelled', { count: cancelled });
  }
  return t(`chat.tool-status-${group.status}`, {
    defaultValue: displayStatus(group.status),
  });
}

function statusClassName(status: string): string {
  if (status === 'failed' || status === 'outcome_unknown') {
    return 'text-ds-text-error-default-default';
  }
  if (status === 'timed_out') {
    return 'text-ds-text-warning-default-default';
  }
  if (status === 'running' || status === 'pending') {
    return 'text-ds-text-information-default-default';
  }
  if (status === 'completed') {
    return 'text-ds-text-success-default-default';
  }
  return 'text-ds-ink-muted-default';
}

/** Optional second-level accordion for one consecutive burst of repeat calls. */
export function RepeatedToolCallGroup({ group }: RepeatedToolCallGroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const toolTitle = `${group.toolkitName} · ${group.methodName}`;
  const title = t('chat.repeated-tool-events', {
    tool: toolTitle,
    count: group.calls.length,
  });

  return (
    <section
      aria-label={t('chat.repeated-tool-calls-label', { tool: toolTitle })}
      className="overflow-hidden rounded-xl border border-x border-y border-ds-hairline-subtle-default bg-ds-neutral-subtle-default"
      data-tool-call-group
      data-tool-call-count={group.calls.length}
      data-tool-call-method={group.methodName}
      data-tool-call-status={group.status}
      data-tool-call-toolkit={group.toolkitName}
    >
      <button
        type="button"
        aria-expanded={open}
        className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-ds-neutral-default-hover focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:outline-none focus-visible:ring-inset"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {open ? (
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 text-ds-ink-subtle-default opacity-100 transition-opacity duration-200"
            />
          ) : (
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-ds-ink-subtle-default opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100"
            />
          )}
          <span className="truncate text-ds-text-base font-medium text-ds-ink-default-default">
            {title}
          </span>
        </span>
        <span
          className={`shrink-0 text-ds-text-meta ${statusClassName(group.status)}`}
        >
          {groupStatusLabel(group, t)}
        </span>
      </button>

      {open ? (
        <div className="border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default px-4 py-2">
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {group.calls.map((call, index) => {
              const node = call.presentedNode;
              return (
                <li
                  key={call.id}
                  className="rounded-lg bg-ds-neutral-default-default px-3 py-2"
                  data-tool-call-id={node.toolCallId || call.id}
                  data-tool-call-index={index + 1}
                  data-tool-call-status={node.status}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ds-text-base font-medium text-ds-ink-default-default">
                      {toolTitle}
                    </span>
                    <span
                      className={`text-ds-text-meta ${statusClassName(node.status)}`}
                    >
                      {t(`chat.tool-status-${node.status}`, {
                        defaultValue: displayStatus(node.status),
                      })}
                    </span>
                  </div>
                  {node.detail ? (
                    <span className="mt-1 block text-ds-text-base font-normal break-words whitespace-pre-wrap text-ds-ink-subtle-default">
                      {node.detail}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

export type { RepeatedToolCallGroupProps };
