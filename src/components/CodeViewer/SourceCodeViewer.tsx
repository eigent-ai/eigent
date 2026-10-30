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

import { lazy, Suspense } from 'react';

export interface SourceCodeViewerProps {
  value: string;
  path: string;
  appearance: string;
  ariaLabel?: string;
}

const MonacoSourceCodeViewer = lazy(() => import('./MonacoSourceCodeViewer'));

/** Lightweight boundary so opening Files does not synchronously load Monaco. */
export function SourceCodeViewer(props: SourceCodeViewerProps) {
  return (
    <Suspense
      fallback={
        <div
          data-testid="source-code-viewer-loading"
          className="h-full min-h-48 w-full animate-pulse bg-ds-neutral-subtle-default"
        />
      }
    >
      <MonacoSourceCodeViewer {...props} />
    </Suspense>
  );
}
