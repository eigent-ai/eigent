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

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

/**
 * Language-service workers Monaco may request. We don't bundle them, so each
 * gets a no-op worker: diagnostics/completions for those languages stay off,
 * but Monaco never throws for a missing worker.
 */
const LANGUAGE_WORKER_LABELS = new Set([
  'json',
  'css',
  'scss',
  'less',
  'html',
  'handlebars',
  'razor',
  'typescript',
  'javascript',
]);

function noopWorker(): Worker {
  return new Worker(
    URL.createObjectURL(
      new Blob([`self.onmessage = function () {};`], {
        type: 'application/javascript',
      })
    )
  );
}

/**
 * Install Monaco's worker environment. The base editor worker is real (it
 * computes diffs — the DiffEditor never renders changes without it); language
 * workers are no-ops. Safe to call repeatedly; every Monaco entry point should
 * call it before creating an editor so the last-loaded module can't downgrade
 * the environment.
 */
export function ensureMonacoWorkers(): void {
  (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker(_moduleId: string, label: string): Worker {
      if (LANGUAGE_WORKER_LABELS.has(label)) return noopWorker();
      return new EditorWorker();
    },
  };
}
