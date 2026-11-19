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

import WindowControls from '@/components/WindowControls';
import { useHost } from '@/host';

/**
 * Title-bar strip for full-window routes that render outside the app shell.
 * Desktop windows have no native title row, so these routes still need a
 * drag area that stays clear of the platform window controls.
 */
export function WindowTitleBar() {
  const host = useHost();
  if (!host?.electronAPI) return null;

  return (
    <div className="flex h-10 shrink-0" data-testid="window-title-bar">
      <div className="window-chrome-safe-area drag flex h-full items-center justify-end">
        <WindowControls />
      </div>
    </div>
  );
}
