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

import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '../ui/button';

// Zoom Controls Component
interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export const ZoomControls = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: ZoomControlsProps) => {
  return (
    <div className="group top-0 absolute left-1/2 z-10 -translate-x-1/2">
      <div className="bg-surface-hover-subtle/90 border-border-subtle-strong/50 gap-1 px-3 py-1.5 shadow-lg backdrop-blur-xl ease-out flex translate-y-[calc(-100%-8px)] items-center rounded-full border transition-transform duration-300 group-hover:translate-y-[20px]">
        <Button
          size="xs"
          buttonContent="icon-only"
          variant="ghost"
          onClick={onZoomOut}
          title="Zoom Out"
          className="h-7 w-7 text-text-secondary hover:bg-fill-fill-transparent-hover hover:text-text-primary"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs font-medium text-text-primary min-w-[2.5rem] text-center tabular-nums">
          {zoom}%
        </span>
        <Button
          size="xs"
          buttonContent="icon-only"
          variant="ghost"
          onClick={onZoomIn}
          title="Zoom In"
          className="h-7 w-7 text-text-secondary hover:bg-fill-fill-transparent-hover hover:text-text-primary"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <div className="mx-0.5 h-4 bg-border-secondary w-px" />
        <Button
          size="xs"
          buttonContent="icon-only"
          variant="ghost"
          onClick={onZoomReset}
          title="Reset Zoom"
          className="h-7 w-7 text-text-secondary hover:bg-fill-fill-transparent-hover hover:text-text-primary"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};
