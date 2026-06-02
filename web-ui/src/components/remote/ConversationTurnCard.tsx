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

import type { RemoteControlStep } from '@/api/remoteControl';
import { Button } from '@/components/ui/button';
import type { ConversationTurn } from '@/lib/remoteControlTurns';
import { cn } from '@/lib/utils';
import { Check, Copy, Loader2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { RemoteMarkdown } from './RemoteMarkdown';
import { RemoteWorkLog } from './RemoteWorkLog';

const COPIED_RESET_MS = 2000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function extractResponseText(step: RemoteControlStep): string {
  if (typeof step.data === 'string') return step.data.trim();
  const data = asRecord(step.data);
  for (const key of [
    'content',
    'message',
    'notice',
    'answer',
    'question',
    'summary',
    'description',
  ]) {
    const v = data[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Copy / thumbs-up / thumbs-down actions shown below the agent markdown. */
function AgentMessageActions({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }, [content]);

  const handleFeedback = useCallback(() => {
    toast.success('Thanks for your feedback!');
  }, []);

  return (
    <div className="mt-3 gap-1 flex shrink-0 justify-start">
      <Button
        variant="ghost"
        size="xs"
        buttonContent="icon-only"
        buttonRadius="full"
        aria-label="Copy"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="h-4 w-4 text-ds-text-success-default-default" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        buttonContent="icon-only"
        buttonRadius="full"
        aria-label="Thumbs up"
        onClick={handleFeedback}
      >
        <ThumbsUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        buttonContent="icon-only"
        buttonRadius="full"
        aria-label="Thumbs down"
        onClick={handleFeedback}
      >
        <ThumbsDown className="h-4 w-4" />
      </Button>
    </div>
  );
}

function AgentResponseBlock({
  step,
  status,
}: {
  step: RemoteControlStep;
  status: ConversationTurn['status'];
}) {
  const text = extractResponseText(step);

  // No leading icon — render the agent output as markdown content only,
  // followed by the copy / feedback action row.
  if (text) {
    return (
      <div className="flex flex-col">
        <RemoteMarkdown content={text} />
        <AgentMessageActions content={text} />
      </div>
    );
  }

  const fallback =
    status === 'waiting_input'
      ? 'Waiting for your reply…'
      : status === 'done'
        ? 'Task completed'
        : status === 'error'
          ? 'Something went wrong.'
          : '';
  if (!fallback) return null;

  return (
    <p
      className={cn(
        'm-0 text-body-sm italic',
        status === 'error'
          ? 'text-ds-text-error-default-default'
          : 'text-ds-text-neutral-muted-default'
      )}
    >
      {fallback}
    </p>
  );
}

function RunningIndicator() {
  return (
    <div className="gap-2 flex items-center">
      <div className="h-6 w-6 rounded-lg bg-ds-bg-neutral-muted-default flex shrink-0 items-center justify-center">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-ds-icon-neutral-muted-default" />
      </div>
      <span className="text-body-sm text-ds-text-neutral-muted-default">
        Running…
      </span>
    </div>
  );
}

interface ConversationTurnCardProps {
  turn: ConversationTurn;
  className?: string;
}

export function ConversationTurnCard({
  turn,
  className,
}: ConversationTurnCardProps) {
  const hasWorkLog = turn.workLog.length > 0;
  const showResponse = turn.agentResponse !== null;
  const showRunning = turn.status === 'running' && !showResponse;

  return (
    <div className={cn('gap-3 flex flex-col', className)}>
      {/* User query bubble — only rendered when present */}
      {turn.userQuery && (
        <div className="flex justify-end">
          <div className="rounded-2xl rounded-br-md bg-ds-bg-neutral-default-default px-4 py-2.5 max-w-[80%]">
            <p className="text-body-sm text-ds-text-neutral-default-default m-0 break-words whitespace-pre-wrap">
              {turn.userQuery}
            </p>
          </div>
        </div>
      )}

      {/* Agent section: work log + response */}
      {(hasWorkLog || showResponse || showRunning) && (
        <div className="gap-3 px-1 flex flex-col">
          {/* Work log accordion */}
          {hasWorkLog && (
            <RemoteWorkLog steps={turn.workLog} status={turn.status} />
          )}

          {/* Agent response */}
          {showResponse && turn.agentResponse && (
            <AgentResponseBlock
              step={turn.agentResponse}
              status={turn.status}
            />
          )}

          {/* In-progress indicator when no response yet */}
          {showRunning && !hasWorkLog && <RunningIndicator />}
        </div>
      )}
    </div>
  );
}
