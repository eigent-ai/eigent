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

import { releaseDiffEditorModels } from '@/components/Session/PreviewPanel/tabs/review/monacoModelLifecycle';
import type * as monaco from 'monaco-editor';
import { describe, expect, it, vi } from 'vitest';

function model(
  label: string,
  calls: string[],
  attached = false
): monaco.editor.ITextModel {
  return {
    isDisposed: () => false,
    isAttachedToEditor: () => attached,
    dispose: vi.fn(() => calls.push(`dispose:${label}`)),
  } as unknown as monaco.editor.ITextModel;
}

describe('releaseDiffEditorModels', () => {
  it('detaches the widget before disposing its unshared models', () => {
    const calls: string[] = [];
    const original = model('original', calls);
    const modified = model('modified', calls);
    const editor = {
      getModel: () => ({ original, modified }),
      setModel: vi.fn((value) => calls.push(`set:${String(value)}`)),
    } as unknown as Pick<
      monaco.editor.IStandaloneDiffEditor,
      'getModel' | 'setModel'
    >;

    releaseDiffEditorModels(editor);

    expect(calls).toEqual(['set:null', 'dispose:original', 'dispose:modified']);
  });

  it('does not dispose a model still shared with another editor', () => {
    const calls: string[] = [];
    const original = model('original', calls, true);
    const modified = model('modified', calls);
    const editor = {
      getModel: () => ({ original, modified }),
      setModel: vi.fn(),
    } as unknown as Pick<
      monaco.editor.IStandaloneDiffEditor,
      'getModel' | 'setModel'
    >;

    releaseDiffEditorModels(editor);

    expect(original.dispose).not.toHaveBeenCalled();
    expect(modified.dispose).toHaveBeenCalledOnce();
  });
});
