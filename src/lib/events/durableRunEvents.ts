// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");

export const DURABLE_RUN_STATUS_CHANGED_EVENT =
  'eigent:durable-run-status-changed';

export const RUN_STREAM_REOPENED_EVENT = 'eigent:run-stream-reopened';

export function notifyDurableRunStatusChanged(projectId: string): void {
  window.dispatchEvent(
    new CustomEvent(DURABLE_RUN_STATUS_CHANGED_EVENT, {
      detail: { projectId },
    })
  );
}

/** A reopened Run stream proves Brain is reachable and may carry missed facts. */
export function notifyRunStreamReopened(runId: string): void {
  window.dispatchEvent(
    new CustomEvent(RUN_STREAM_REOPENED_EVENT, { detail: { runId } })
  );
}

export function onRunStreamReopened(
  runId: string | undefined,
  listener: () => void
): () => void {
  const handleReopened = (event: Event) => {
    const reopened = (event as CustomEvent<{ runId?: string }>).detail?.runId;
    if (runId && reopened === runId) listener();
  };
  window.addEventListener(RUN_STREAM_REOPENED_EVENT, handleReopened);
  return () =>
    window.removeEventListener(RUN_STREAM_REOPENED_EVENT, handleReopened);
}
