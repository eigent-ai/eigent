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
import ShinyText from '@/components/ui/ShinyText';
import type { TurnStatus } from '@/lib/remoteControlTurns';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, CheckCircle2, Expand, Info, Wrench, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// ─── Data helpers ────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function getString(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function formatTimestamp(
  ts: number | null | undefined,
  stepId: number
): string {
  if (!ts) return `#${stepId}`;
  // Backend may send seconds or milliseconds — heuristic: < 1e12 means seconds
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return `#${stepId}`;
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function humanizeStep(step: string): string {
  return step.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function stepDetail(step: RemoteControlStep): string {
  if (typeof step.data === 'string') return step.data.trim();
  const data = asRecord(step.data);
  return getString(
    data,
    'agent',
    'name',
    'toolkit_name',
    'method_name',
    'message',
    'content',
    'notice',
    'summary'
  );
}

function StepIcon({ stepType }: { stepType: string }) {
  let Icon = Zap;
  if (stepType === 'activate_agent' || stepType === 'create_agent') Icon = Bot;
  else if (stepType === 'deactivate_agent') Icon = CheckCircle2;
  else if (stepType === 'activate_toolkit' || stepType === 'deactivate_toolkit')
    Icon = Wrench;
  else if (stepType === 'notice') Icon = Info;

  const isAgent = stepType === 'activate_agent' || stepType === 'create_agent';
  const isDone = stepType === 'deactivate_agent';
  const isTool =
    stepType === 'activate_toolkit' || stepType === 'deactivate_toolkit';
  const isNotice = stepType === 'notice';

  return (
    <div
      className={cn(
        'mt-0.5 h-6 w-6 rounded-md flex shrink-0 items-center justify-center',
        isAgent &&
          'bg-ds-bg-information-subtle-default text-ds-icon-information-default-default',
        isDone &&
          'bg-ds-bg-status-completed-subtle-default text-ds-text-status-completed-default-default',
        isTool &&
          'bg-ds-bg-neutral-muted-default text-ds-icon-neutral-subtle-default',
        isNotice &&
          'bg-ds-bg-neutral-muted-default text-ds-icon-neutral-muted-default',
        !isAgent &&
          !isDone &&
          !isTool &&
          !isNotice &&
          'bg-ds-bg-neutral-muted-default text-ds-icon-neutral-subtle-default'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </div>
  );
}

// ─── Rolling number ──────────────────────────────────────────────────────────

function RollingNumber({ value }: { value: number }) {
  return (
    <span className="relative inline-flex h-[1em] items-center overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: '60%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          exit={{ y: '-60%', opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          className="!text-label-sm font-normal text-ds-text-neutral-muted-default tabular-nums"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

// ─── Log dialog item ─────────────────────────────────────────────────────────

function LogItem({ step }: { step: RemoteControlStep }) {
  const title = humanizeStep(step.step);
  const detail = stepDetail(step);
  const time = formatTimestamp(step.timestamp, step.step_id);

  return (
    <div className="gap-3 px-4 py-3 flex items-start">
      <StepIcon stepType={step.step} />
      <div className="min-w-0 gap-0.5 flex flex-col">
        <span className="text-body-sm font-medium text-ds-text-neutral-default-default">
          {title}
          {detail && (
            <span className="ml-1.5 font-normal text-ds-text-neutral-muted-default">
              · {detail.length > 120 ? `${detail.slice(0, 119)}…` : detail}
            </span>
          )}
        </span>
        <span className="text-label-xs text-ds-text-neutral-subtle-default tabular-nums">
          {time}
        </span>
      </div>
    </div>
  );
}

// ─── Full-screen dialog ───────────────────────────────────────────────────────

interface WorkLogDialogProps {
  open: boolean;
  steps: RemoteControlStep[];
  onClose: () => void;
}

const dialogTransition = { duration: 0.2, ease: [0.32, 0.72, 0, 1] } as const;

function WorkLogDialog({ open, steps, onClose }: WorkLogDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="work-log-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="work-log-dialog-title"
          className="bg-ds-bg-neutral-subtle-default inset-0 fixed z-[60] flex flex-col overflow-hidden"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={dialogTransition}
        >
          {/* Header — full width */}
          <header className="h-14 px-4 border-ds-border-neutral-subtle-default flex w-full shrink-0 items-center justify-between border-x-0 border-t-0 border-b border-solid">
            <span
              id="work-log-dialog-title"
              className="text-body-sm font-semibold text-ds-text-neutral-default-default"
            >
              Task Log
              <span className="ml-1.5 font-normal text-ds-text-neutral-muted-default">
                · {steps.length} event{steps.length !== 1 ? 's' : ''}
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              buttonRadius="full"
              aria-label="Close task log"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </header>

          {/* Log body — centered 600px column */}
          <div className="scrollbar scrollbar-always-visible min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[600px]">
              {steps.length === 0 ? (
                <div className="flex min-h-[50vh] items-center justify-center">
                  <p className="text-body-sm text-ds-text-neutral-muted-default">
                    No log entries yet.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col">
                  {steps.map((step) => (
                    <LogItem key={step.step_id} step={step} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

interface RemoteWorkLogProps {
  steps: RemoteControlStep[];
  status: TurnStatus;
  className?: string;
}

export function RemoteWorkLog({
  steps,
  status,
  className,
}: RemoteWorkLogProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (steps.length === 0) return null;

  const taskRunning = status === 'running';

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className={cn(
          'gap-1.5 px-2 py-1 bg-ds-bg-neutral-default-default hover:bg-ds-bg-neutral-default-hover rounded-lg inline-flex w-fit items-center text-left transition-opacity',
          className
        )}
      >
        <ShinyText
          text="Working in progress"
          speed={2.5}
          disabled={!taskRunning}
          className="!text-label-sm font-normal"
        />
        <span className="!text-label-sm text-ds-text-neutral-subtle-default">
          ·
        </span>
        <RollingNumber value={steps.length} />
        <span className="!text-label-sm font-normal text-ds-text-neutral-muted-default">
          event{steps.length !== 1 ? 's' : ''}
        </span>
        <Expand
          size={13}
          className="text-ds-icon-neutral-subtle-default shrink-0"
        />
      </button>

      <WorkLogDialog
        open={dialogOpen}
        steps={steps}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}
