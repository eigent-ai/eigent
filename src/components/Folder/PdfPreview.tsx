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

import { useHost, type AppShellElectronAPI } from '@/host';
import { isSameFrameUrl } from '@/shared/subframeLoadFailure';
import { useLayoutEffect, useState } from 'react';

/** The browser owns PDF rendering, navigation, zoom, download, print, password
 * prompts and document errors. An iframe load event is not proof that a PDF
 * rendered, so do not overlay an app-owned loading or success state.
 * Uses the existing third-party-viewports exception for native viewer chrome. */
export function PdfPreview({ url, name }: { url: string; name: string }) {
  return (
    <iframe
      src={url}
      title={name}
      className="h-full min-h-0 w-full flex-1 border-0 border-x-0 border-y-0"
    />
  );
}

/** True once the desktop host reports that the frame loading `url` failed and
 * now shows a blank browser error page. Resets when `url` changes, so selecting
 * the file again retries the frame. */
export function usePdfFrameLoadFailed(url: string | undefined): boolean {
  const subscribe = (useHost()?.electronAPI as AppShellElectronAPI | undefined)
    ?.onSubframeLoadFailed;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  // Subscribe in the same commit that inserts the iframe, before its
  // navigation can fail and be reported.
  useLayoutEffect(() => {
    if (!url || !subscribe) return;
    const unsubscribe = subscribe((failure) => {
      if (isSameFrameUrl(failure.url, url)) setFailedUrl(url);
    });
    return () => {
      unsubscribe();
      setFailedUrl(null);
    };
  }, [subscribe, url]);

  return Boolean(url) && failedUrl === url;
}
