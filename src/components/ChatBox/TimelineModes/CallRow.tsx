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
import { ToolInputOutputDetails } from '@/components/ChatBox/MessageItem/ToolInputOutputDetails';
import ShinyText from '@/components/ui/ShinyText/ShinyText';
import { DsIcon } from '@/components/ui/ds-icon';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import type { TimelineCall } from '@/lib/projector/chat/presentation';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { actionIcon } from './actionIcon';
import { disclosureMotion } from './shared';

const ERROR_STATUSES = new Set(['failed', 'timed_out', 'outcome_unknown']);

function formatCallDuration(durationMs: number | undefined): string | null {
  if (
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return null;
  }
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) {
    const seconds = Number((durationMs / 1_000).toFixed(1));
    return `${seconds} s`;
  }
  return formatSplittingElapsed(durationMs);
}

export function isCallErrorStatus(status: TimelineCall['status']): boolean {
  return ERROR_STATUSES.has(status);
}

export function isCallActiveStatus(status: TimelineCall['status']): boolean {
  return status === 'running' || status === 'pending';
}

interface CallRowProps {
  call: TimelineCall;
  runActive: boolean;
  /** Row id that currently owns the single running shimmer, if any. */
  latestRunningCallId?: string | null;
  reducedMotion: boolean;
}

/**
 * One request/response record, whoever produced the response.
 *
 * A toolkit invocation and a human interaction share this row because they
 * share a shape: a request, an executor, and a response. Only the labels and
 * the title grammar differ, both of which arrive on the `TimelineCall`.
 *
 * The row always renders in the subdued label treatment. Primary text in the
 * narrative timeline is reserved for the agent's own words.
 */
export function CallRow({
  call,
  runActive,
  latestRunningCallId = null,
  reducedMotion,
}: CallRowProps) {
  const { t } = useTranslation();
  const running = runActive && isCallActiveStatus(call.status);
  const highlighted = running && call.id === latestRunningCallId;
  const failed = isCallErrorStatus(call.status);
  const pendingHuman = call.executor === 'human' && call.status === 'pending';
  const showWaitingOutput = !call.output && (running || pendingHuman);
  const description =
    call.notice?.content.trim() ||
    call.detail ||
    (!call.input && !call.output && !showWaitingOutput
      ? failed
        ? t('chat.no-failure-details', {
            defaultValue: 'No failure details were recorded.',
          })
        : t('chat.completed', { defaultValue: 'Completed.' })
      : undefined);
  const duration = formatCallDuration(call.durationMs);
  let statusSummary: string;
  switch (call.status) {
    case 'completed':
      statusSummary = duration
        ? t('chat.timeline-completed-in', {
            defaultValue: 'Completed in {{duration}}',
            duration,
          })
        : t('chat.timeline-completed', { defaultValue: 'Completed' });
      break;
    case 'failed':
      statusSummary = t('chat.timeline-failed', { defaultValue: 'Failed' });
      break;
    case 'timed_out':
      statusSummary = t('chat.timeline-timed-out', {
        defaultValue: 'Timed out',
      });
      break;
    case 'cancelled':
      statusSummary = t('chat.timeline-cancelled', {
        defaultValue: 'Cancelled',
      });
      break;
    case 'blocked':
      statusSummary = t('chat.timeline-blocked', {
        defaultValue: 'Blocked',
      });
      break;
    case 'interrupted':
      statusSummary = t('chat.timeline-interrupted', {
        defaultValue: 'Interrupted',
      });
      break;
    case 'pending':
    case 'running':
      statusSummary = t('chat.timeline-in-progress', {
        defaultValue: 'In progress',
      });
      break;
    case 'outcome_unknown':
    case 'unknown':
      statusSummary = t('chat.tool-status-unknown', {
        defaultValue: 'Unknown',
      });
      break;
  }
  const metadataParts = [
    call.notice?.title?.trim() || call.title.trim(),
    statusSummary?.trim(),
  ].filter(
    (part, index, parts): part is string =>
      Boolean(part) && parts.indexOf(part) === index
  );
  // A pending human call is the one thing the user must act on, so it opens
  // itself. Everything else follows the shimmer/auto-collapse rule.
  const autoExpanded = highlighted || pendingHuman;
  const [open, setOpen] = useState(autoExpanded);
  const wasAutoExpanded = useRef(autoExpanded);

  useEffect(() => {
    if (autoExpanded) setOpen(true);
    else if (wasAutoExpanded.current) setOpen(false);
    wasAutoExpanded.current = autoExpanded;
  }, [autoExpanded]);

  return (
    <div
      className="flex w-full min-w-0 flex-col items-start"
      data-timeline-call-executor={call.executor}
      data-timeline-call-id={call.toolCallId || call.interactionId}
      data-timeline-call-status={call.status}
      data-timeline-action-kind={call.actionKind}
      data-timeline-call-highlighted={highlighted ? 'true' : undefined}
      data-interaction-id={call.interactionId}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex max-w-full min-w-0 items-center gap-ds-6 self-start rounded-ds-compact-control px-0 py-ds-2 text-left transition-opacity hover:opacity-80',
          DS_FOCUS_RING,
          failed && 'text-ds-text-status-error-default-default'
        )}
        data-timeline-call-trigger
      >
        <DsIcon
          icon={actionIcon(call.actionKind)}
          recipe="main"
          className={cn(
            failed
              ? 'text-ds-text-status-error-default-default'
              : 'text-ds-ink-subtle-default'
          )}
          data-timeline-action-icon={call.actionKind}
        />
        {highlighted ? (
          <ShinyText
            text={call.title}
            speed={2.5}
            className="min-w-0 shrink overflow-hidden !text-ds-text-base !font-normal text-ellipsis whitespace-nowrap text-ds-ink-subtle-default"
          />
        ) : (
          <span
            className={cn(
              'min-w-0 shrink overflow-hidden !text-ds-text-base font-normal text-ellipsis whitespace-nowrap',
              failed
                ? 'text-ds-text-status-error-default-default'
                : 'text-ds-ink-subtle-default'
            )}
          >
            {call.title}
          </span>
        )}
        {failed ? (
          <span className="sr-only">
            {call.executor === 'human'
              ? t('chat.request-not-completed', {
                  defaultValue: 'This request was not completed.',
                })
              : t('chat.tool-call-failed', {
                  defaultValue: 'Tool call failed.',
                })}
          </span>
        ) : null}
        <DsIcon
          icon={ChevronRight}
          className={cn(
            'transition-transform duration-200',
            failed
              ? 'text-ds-text-status-error-default-default'
              : 'text-ds-ink-subtle-default',
            open && 'rotate-90'
          )}
          data-timeline-call-chevron
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="timeline-call-detail"
            {...disclosureMotion(reducedMotion)}
            className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-ds-6 overflow-hidden"
          >
            <span
              aria-hidden
              className="w-ds-icon-main"
              data-timeline-call-indent
            />
            <div
              className="flex w-full min-w-0 flex-col gap-ds-10 pt-ds-4"
              data-timeline-call-content
            >
              <div
                className={cn(
                  'flex min-w-0 flex-wrap items-baseline gap-ds-8 !text-ds-text-meta font-normal break-words text-ds-ink-muted-default',
                  failed && 'text-ds-text-status-error-default-default',
                  call.notice?.severity === 'warning' &&
                    'text-ds-text-warning-strong-default'
                )}
                data-timeline-call-metadata
              >
                {metadataParts.map((part, index) => (
                  <span
                    key={`${index}-${part}`}
                    className={cn(
                      index > 0 && 'inline-flex items-baseline gap-ds-8'
                    )}
                  >
                    {index > 0 ? (
                      <span aria-hidden data-timeline-call-separator>
                        ·
                      </span>
                    ) : null}
                    <span>{part}</span>
                  </span>
                ))}
              </div>
              <ToolInputOutputDetails
                appearance="code-scroll"
                description={description}
                input={call.input}
                inputLabel={call.inputLabel}
                output={call.output}
                outputLabel={call.outputLabel}
                showEmptyOutput={showWaitingOutput}
                emptyOutputText={
                  call.emptyOutputText ||
                  (running ? 'Waiting for a response.' : 'Waiting for you.')
                }
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
