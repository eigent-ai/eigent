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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  return (
    <div className="group absolute top-0 left-1/2 z-10 -translate-x-1/2">
      <div className="zoom-controls-reveal flex items-center gap-1 rounded-full border border-x border-y border-ds-hairline-subtle-default bg-ds-neutral-default-default px-3 py-1.5 shadow-lg backdrop-blur-xl">
        <Button
          size="xs"
          buttonContent="icon-only"
          variant="ghost"
          onClick={onZoomOut}
          title={t('layout.zoom-out', { defaultValue: 'Zoom out' })}
          className="h-7 w-7 text-ds-ink-muted-default hover:bg-ds-neutral-subtle-hover hover:text-ds-ink-default-default"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[2.5rem] text-center text-xs font-medium text-ds-ink-default-default tabular-nums">
          {zoom}%
        </span>
        <Button
          size="xs"
          buttonContent="icon-only"
          variant="ghost"
          onClick={onZoomIn}
          title={t('layout.zoom-in', { defaultValue: 'Zoom in' })}
          className="h-7 w-7 text-ds-ink-muted-default hover:bg-ds-neutral-subtle-hover hover:text-ds-ink-default-default"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <div className="mx-0.5 h-4 w-px bg-ds-border-neutral-default-default" />
        <Button
          size="xs"
          buttonContent="icon-only"
          variant="ghost"
          onClick={onZoomReset}
          title={t('layout.reset-zoom', { defaultValue: 'Reset zoom' })}
          className="h-7 w-7 text-ds-ink-muted-default hover:bg-ds-neutral-subtle-hover hover:text-ds-ink-default-default"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};
