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

import type * as monaco from 'monaco-editor';

/**
 * Release a DiffEditor model pair in the order required by Monaco 0.52+.
 *
 * @monaco-editor/react 4.7 disposes the text models before its widget. Monaco
 * rejects that ordering because the widget is still subscribed to the models.
 * Detaching the pair first lets the wrapper dispose its widget afterward while
 * keeping model ownership explicit and leak-free here.
 */
export function releaseDiffEditorModels(
  editor: Pick<monaco.editor.IStandaloneDiffEditor, 'getModel' | 'setModel'>
): void {
  const models = editor.getModel();
  editor.setModel(null);
  if (!models) return;

  for (const model of [models.original, models.modified]) {
    if (!model.isDisposed() && !model.isAttachedToEditor()) model.dispose();
  }
}
