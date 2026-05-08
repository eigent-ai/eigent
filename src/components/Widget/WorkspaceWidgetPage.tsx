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

import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectStore } from '@/store/projectStore';
import { useWidgetStore } from '@/store/widgetStore';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { WidgetHtmlFrame } from './WidgetHtmlFrame';

export function WorkspaceWidgetPage() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const email = useAuthStore((s) => s.email);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const widget = useWidgetStore((s) =>
    activeProjectId ? s.widgetsByProjectId[activeProjectId] : null
  );
  const loading = useWidgetStore((s) =>
    activeProjectId ? Boolean(s.loadingByProjectId[activeProjectId]) : false
  );
  const refreshProjectWidget = useWidgetStore((s) => s.refreshProjectWidget);
  const [frameKey, setFrameKey] = useState(0);

  const title = widget?.manifest?.name || 'Widget';

  const handleRefresh = async () => {
    if (!activeProjectId || !email) return;
    try {
      const refreshed = await refreshProjectWidget(activeProjectId, email);
      if (!refreshed.exists) {
        toast.error('No widget folder found for this project.');
      }
      setFrameKey((value) => value + 1);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to refresh widget.'
      );
    }
  };

  return (
    <div className="min-h-0 flex h-full w-full flex-col overflow-hidden">
      <div className="px-3 gap-1 relative flex h-[44px] w-full shrink-0 flex-row items-center justify-start">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          buttonContent="text"
          onClick={() => setActiveWorkspaceTab('workforce')}
          className="no-drag shrink-0"
          aria-label="Back to workspace"
        >
          <ArrowLeft aria-hidden />
          Back
        </Button>
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="!text-label-sm font-semibold text-ds-text-neutral-default-default block max-w-[60vw] truncate text-center">
            {title}
          </span>
        </div>
        <div className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          buttonContent="text"
          onClick={handleRefresh}
          disabled={loading}
          className="no-drag shrink-0"
        >
          <RefreshCw
            className={`h-4 w-4 text-ds-icon-neutral-default-default ${loading ? 'animate-spin' : ''}`}
            aria-hidden
          />
          Refresh
        </Button>
      </div>

      <div className="min-h-0 p-3 flex flex-1 overflow-hidden">
        <div className="rounded-2xl bg-ds-bg-neutral-subtle-default border-ds-border-neutral-subtle-disabled text-ds-text-neutral-default-default min-h-0 flex h-full w-full overflow-hidden border border-solid">
          {widget?.exists ? (
            <WidgetHtmlFrame
              html={widget.entryHtml}
              basePath={widget.entryUrl}
              title={title}
              reloadKey={`${widget.updatedAt || ''}-${frameKey}`}
              className="h-full w-full border-0 bg-transparent"
            />
          ) : (
            <div className="px-6 text-body-sm flex h-full w-full items-center justify-center text-center">
              No widget folder found for this project.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
