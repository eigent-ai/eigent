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

import { Minus, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './index.css';

export default function WindowControls() {
  const controlsRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string>('');

  useEffect(() => {
    const p = window.electronAPI?.getPlatform();
    if (p) setPlatform(p);

    // Hide custom controls on macOS (uses native traffic lights)
    // and on Windows (now uses native frame with native controls)
    if (p === 'darwin' || p === 'win32') {
      if (controlsRef.current) {
        controlsRef.current.style.display = 'none';
      }
    }
  }, []);

  // Don't render custom controls on macOS or Windows (both use native controls)
  if (platform === 'darwin' || platform === 'win32') {
    return null;
  }

  return (
    <div
      className="window-controls flex h-full items-center"
      id="window-controls"
      ref={controlsRef}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div
        className="control-btn h-full flex-1"
        onClick={() => window.electronAPI.minimizeWindow()}
      >
        <Minus className="h-4 w-4" />
      </div>
      <div
        className="control-btn h-full flex-1"
        onClick={() => window.electronAPI.toggleMaximizeWindow()}
      >
        <Square className="h-4 w-4" />
      </div>
      <div
        className="control-btn h-full flex-1"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          // Trigger window close - this will go through the before-close handler
          // which checks if tasks are running and shows confirmation if needed
          window.electronAPI.closeWindow(false);
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        <X className="h-4 w-4" />
      </div>
    </div>
  );
}
