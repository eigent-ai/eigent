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

import type { ProjectWidget } from '@/store/widgetStore';
import { BarChart3 } from 'lucide-react';
import { WidgetHtmlFrame } from './WidgetHtmlFrame';

export const WORKSPACE_WIDGET_PANEL_WIDTH_CLASS = 'w-[280px]';

interface WorkspaceWidgetPreviewProps {
  widget: ProjectWidget;
  onOpen: () => void;
}

export function WorkspaceWidgetPreview({
  widget,
  onOpen,
}: WorkspaceWidgetPreviewProps) {
  const title = widget.manifest?.name || 'Widget';

  return (
    <aside
      className={`${WORKSPACE_WIDGET_PANEL_WIDTH_CLASS} min-h-0 pl-2 pb-3 shrink-0`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="rounded-2xl bg-ds-bg-neutral-subtle-default border-ds-border-neutral-subtle-disabled text-ds-text-neutral-default-default focus-visible:ring-ds-border-brand-default-focus relative flex aspect-square w-full cursor-pointer flex-col overflow-hidden border border-solid text-left transition-opacity outline-none hover:opacity-90 focus-visible:ring-2"
        aria-label={`Open ${title}`}
      >
        <div className="border-ds-border-neutral-subtle-disabled gap-2 px-3 py-2 flex w-full shrink-0 items-center border-x-0 border-t-0 border-b border-solid">
          <BarChart3
            className="h-4 w-4 text-ds-icon-neutral-default-default shrink-0"
            aria-hidden
          />
          <span className="text-body-sm font-semibold truncate">{title}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <WidgetHtmlFrame
            html={widget.previewHtml}
            basePath={widget.previewUrl}
            title={`${title} preview`}
            interactive={false}
            disableScroll
            reloadKey={widget.updatedAt}
            className="pointer-events-none h-full w-full border-0 bg-transparent"
          />
        </div>
      </button>
    </aside>
  );
}
