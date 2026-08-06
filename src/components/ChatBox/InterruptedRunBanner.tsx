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
            <div className="text-sm font-semibold">{title}</div>
            {attemptNumber != null && (
              <span className="shrink-0 text-[11px] opacity-60">
                #{attemptNumber}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 opacity-80">{description}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onResume}
              disabled={action !== null}
              className="text-white inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-900 px-3 text-xs font-medium disabled:opacity-50 dark:bg-amber-100 dark:text-amber-950"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {action === 'resuming' ? resumingLabel : resumeLabel}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={action !== null}
              className="dark:hover:bg-amber-900/50 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium opacity-75 hover:bg-amber-100 disabled:opacity-40"
            >
              <X className="size-3.5" aria-hidden="true" />
              {action === 'cancelling' ? cancellingLabel : cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
