// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");

export const DURABLE_RUN_STATUS_CHANGED_EVENT =
  'eigent:durable-run-status-changed';

export function notifyDurableRunStatusChanged(projectId: string): void {
  window.dispatchEvent(
    new CustomEvent(DURABLE_RUN_STATUS_CHANGED_EVENT, {
      detail: { projectId },
    })
  );
}
