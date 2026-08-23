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

import { ToolInputOutputDetails } from '@/components/ChatBox/MessageItem/ToolInputOutputDetails';
import ShinyText from '@/components/ui/ShinyText/ShinyText';
import type { TimelineCall } from '@/lib/projector/chat/presentation';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { disclosureMotion } from './shared';

const ERROR_STATUSES = new Set(['failed', 'timed_out', 'outcome_unknown']);

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
  const running = runActive && isCallActiveStatus(call.status);
  const highlighted = running && call.id === latestRunningCallId;
  const failed = isCallErrorStatus(call.status);
  const pendingHuman = call.executor === 'human' && call.status === 'pending';
  const showWaitingOutput = !call.output && (running || pendingHuman);
  const detail =
    call.detail ||
    (!call.input && !call.output && !showWaitingOutput
      ? failed
        ? 'No failure details were recorded.'
        : 'Completed.'
      : undefined);
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
      data-timeline-call-highlighted={highlighted ? 'true' : undefined}
      data-interaction-id={call.interactionId}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'group inline-flex max-w-full min-w-0 items-center gap-1 self-start px-0 py-0.5 text-left transition-opacity hover:opacity-80',
          failed && 'text-ds-text-status-error-default-default'
        )}
        data-timeline-call-trigger
      >
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
              ? 'This request was not completed.'
              : 'Tool call failed.'}
          </span>
        ) : null}
        <ChevronRight
          aria-hidden
          className={cn(
            'size-4 shrink-0 transition-[opacity,transform] duration-200',
            failed
              ? 'text-ds-text-status-error-default-default'
              : 'text-ds-ink-subtle-default',
            open
              ? 'rotate-90 opacity-100'
              : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="timeline-call-detail"
            {...disclosureMotion(reducedMotion)}
            className="w-full min-w-0 overflow-hidden"
          >
            <ToolInputOutputDetails
              className="mt-1"
              input={call.input}
              inputLabel={call.inputLabel}
              output={call.output}
              outputLabel={call.outputLabel}
              showEmptyOutput={showWaitingOutput}
              emptyOutputText={
                call.emptyOutputText ||
                (running ? 'Waiting for a response.' : 'Waiting for you.')
              }
            >
              {detail ? (
                <p
                  className="px-0.5 !text-ds-text-meta font-normal break-words whitespace-pre-wrap text-ds-ink-subtle-default"
                  data-timeline-call-detail
                >
                  {detail}
                </p>
              ) : null}
            </ToolInputOutputDetails>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
