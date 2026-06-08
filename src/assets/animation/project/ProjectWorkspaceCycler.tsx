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

'use client';

import { useEffect, useRef } from 'react';

// 4 log steps × ~3.5s + 2.5s hold ≈ 16s loop
const CYCLE_MS = 3500;
const PAUSE_AT_FULL_MS = 2500;
const ROOT_MARGIN = '200px';

/**
 * Drives the Eigent single-agent workspace animation purely by mutating
 * data-* attributes — no React re-renders. Steps:
 *   0 = reset (only "Preparing agent" visible, nothing done)
 *   1..4 = reveal log group N, mark progress item N-1 done, reveal file(s)
 *   5 (= totalSteps) = all done — hold, then loop.
 */
export default function ProjectWorkspaceCycler({
  totalSteps,
}: {
  totalSteps: number;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const root = anchor.closest<HTMLElement>('[data-cycle-root]');
    if (!root) return;

    const logGroups = Array.from(
      root.querySelectorAll<HTMLElement>('[data-log-step]')
    );
    const progressItems = Array.from(
      root.querySelectorAll<HTMLElement>('[data-progress-index]')
    );
    const folderFiles = Array.from(
      root.querySelectorAll<HTMLElement>('[data-file-step]')
    );
    const workedEl = root.querySelector<HTMLElement>('[data-worked]');
    const folderEmptyEl = root.querySelector<HTMLElement>(
      '[data-folder-empty]'
    );
    const taskActiveEl = root.querySelector<HTMLElement>('[data-task-active]');
    const contextDotEl = root.querySelector<HTMLElement>('[data-context-dot]');
    const tokenEl = root.querySelector<HTMLElement>('[data-token]');

    // Token counts shown at each step (0 = reset, 1-4 = steps, 5 = done)
    const TOKEN_VALUES = [
      '8.3K',
      '54.1K',
      '108.9K',
      '162.5K',
      '196.2K',
      '228.0K',
    ];

    if (logGroups.length === 0) return;

    let step = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let isVisible = true;
    let isTabVisible = !document.hidden;

    const applyStep = () => {
      // Log groups appear cumulatively. The newest one is "active" (spinner),
      // earlier ones are "done", later ones hidden.
      for (const el of logGroups) {
        const groupStep = Number(el.dataset.logStep);
        if (step >= totalSteps) {
          el.dataset.state = 'done';
        } else if (groupStep < step) {
          el.dataset.state = 'done';
        } else if (groupStep === step) {
          el.dataset.state = 'active';
        } else {
          el.dataset.state = 'hidden';
        }
      }

      // Progress items: item i is done once its log step (i+1) has completed.
      for (const el of progressItems) {
        const idx = Number(el.dataset.progressIndex);
        const done = step >= totalSteps ? true : idx < step - 1;
        el.dataset.done = done ? 'true' : 'false';
      }

      // Agent folder files: revealed at their step.
      let anyFile = false;
      for (const el of folderFiles) {
        const fileStep = Number(el.dataset.fileStep);
        const shown = step >= totalSteps ? true : fileStep <= step && step > 0;
        el.dataset.visible = shown ? 'true' : 'false';
        if (shown) anyFile = true;
      }
      if (folderEmptyEl)
        folderEmptyEl.dataset.visible = anyFile ? 'false' : 'true';

      // Context dot mirrors Agent Folder — visible only when files are present.
      if (contextDotEl)
        contextDotEl.dataset.visible = anyFile ? 'true' : 'false';

      // "Worked for" elapsed label.
      if (workedEl) {
        const secs = step >= totalSteps ? 122 : step * 28;
        const m = Math.floor(secs / 60);
        const sLeft = secs % 60;
        workedEl.textContent =
          step >= totalSteps
            ? '2m 02s'
            : `${m > 0 ? m + 'm ' : ''}${String(sLeft).padStart(m > 0 ? 2 : 1, '0')}s`;
      }

      // Sidebar task status icon: spinner while steps are running, done at ends.
      if (taskActiveEl) {
        taskActiveEl.dataset.taskStatus =
          step > 0 && step < totalSteps ? 'running' : 'done';
      }

      // Token counter: roll to the value for this step.
      if (tokenEl) {
        const idx = Math.min(step, totalSteps);
        tokenEl.textContent = TOKEN_VALUES[idx];
        // Alternate a ↔ b to restart the CSS animation each update.
        tokenEl.dataset.tokenAnim =
          tokenEl.dataset.tokenAnim === 'a' ? 'b' : 'a';
      }
    };

    const tick = () => {
      if (!isVisible || !isTabVisible) {
        timer = setTimeout(tick, CYCLE_MS);
        return;
      }
      step = (step + 1) % (totalSteps + 1);
      applyStep();
      timer = setTimeout(
        tick,
        step === totalSteps ? PAUSE_AT_FULL_MS : CYCLE_MS
      );
    };

    // SSR snapshot is step 2; sync the live state to it then begin.
    step = 2;
    applyStep();

    let idleHandle: number | null = null;
    let idleTimeout: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      timer = setTimeout(tick, CYCLE_MS);
    };
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(start, { timeout: 2500 });
    } else {
      idleTimeout = setTimeout(start, 500);
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
      },
      { rootMargin: ROOT_MARGIN }
    );
    io.observe(root);

    const onVisibility = () => {
      isTabVisible = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (timer !== null) clearTimeout(timer);
      if (
        idleHandle !== null &&
        typeof window.cancelIdleCallback === 'function'
      ) {
        window.cancelIdleCallback(idleHandle);
      }
      if (idleTimeout !== null) clearTimeout(idleTimeout);
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [totalSteps]);

  return (
    <span ref={anchorRef} aria-hidden="true" style={{ display: 'none' }} />
  );
}
