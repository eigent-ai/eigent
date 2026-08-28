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

import {
  CODE_FONT_FAMILY,
  READ_ONLY_CODE_OPTIONS,
  codeThemeForAppearance,
  languageForPath,
  registerCodeThemes,
} from '@/lib/codePresentation';
import { ensureMonacoWorkers } from '@/lib/monacoWorkers';
import loader from '@monaco-editor/loader';
import { Editor } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useMemo } from 'react';
import type { SourceCodeViewerProps } from './SourceCodeViewer';

ensureMonacoWorkers();
loader.config({ monaco });
registerCodeThemes(monaco);

export default function MonacoSourceCodeViewer({
  value,
  path,
  appearance,
  ariaLabel,
}: SourceCodeViewerProps) {
  const language = useMemo(
    () => languageForPath(path, monaco.languages.getLanguages()),
    [path]
  );
  const options = useMemo(
    () => ({ ...READ_ONLY_CODE_OPTIONS, ariaLabel: ariaLabel || path }),
    [ariaLabel, path]
  );

  return (
    <div
      className="code-editor-surface h-full min-h-0 w-full"
      style={
        {
          '--code-font-family': CODE_FONT_FAMILY,
        } as React.CSSProperties
      }
    >
      <Editor
        height="100%"
        value={value}
        language={language}
        theme={codeThemeForAppearance(appearance)}
        options={options}
        loading={
          <div className="h-full w-full animate-pulse bg-ds-neutral-subtle-default" />
        }
      />
    </div>
  );
}
