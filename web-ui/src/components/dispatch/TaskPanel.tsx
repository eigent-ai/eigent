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

import eigentAppIconBlack from '@/assets/logo/icon_black.svg';
import eigentAppIconWhite from '@/assets/logo/icon_white.svg';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';
import { sendProjectMessage } from '@web/api/brain';
import { MessageComposer } from '@web/components/project/MessageComposer';
import { SessionReview } from '@web/components/project/SessionReview';
import { SessionSidePanel } from '@web/components/project/SessionSidePanel';
import { useProjectDetail, useSessionPanel } from '@web/hooks/useProjectDetail';
import { useSpaces } from '@web/hooks/useSpaces';
import type { WebProject } from '@web/types';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export function TaskChatView({
  projectId,
  draftProject,
}: {
  projectId: string;
  draftProject?: WebProject | null;
}) {
  const abortRef = useRef<AbortController | null>(null);
  const [liveMessages, setLiveMessages] = useState<string[]>([]);
  const {
    project: loadedProject,
    loading: projectLoading,
    error: projectError,
  } = useProjectDetail(draftProject ? undefined : projectId);
  const project = draftProject ?? loadedProject;
  const activeSession = project?.sessions[0] ?? null;
  const { panel, loading: panelLoading } = useSessionPanel(
    project,
    activeSession?.taskId
  );

  useEffect(() => {
    setLiveMessages([]);
  }, [activeSession?.taskId]);

  const handleSend = useCallback(
    (message: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLiveMessages([]);

      sendProjectMessage({
        projectId,
        question: message,
        signal: controller.signal,
        onEvent: (payload) => {
          const text = extractLiveMessage(payload);
          if (text) {
            setLiveMessages((prev) => [...prev, text]);
          }
        },
      });
    },
    [projectId]
  );

  if (!draftProject && projectLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-ds-text-neutral-muted-default">
        Loading task…
      </div>
    );
  }

  if (!draftProject && projectError) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-ds-text-error-default-default">
        {projectError}
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center text-ds-text-neutral-muted-default">
        Project not found.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 gap-3 overflow-hidden p-3">
      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <SessionReview
          session={activeSession}
          liveMessages={liveMessages}
          onControl={() => undefined}
        />
        <MessageComposer onSend={handleSend} />
      </section>
      <div className="hidden lg:block">
        <SessionSidePanel data={panel} loading={panelLoading} />
      </div>
    </div>
  );
}

function extractLiveMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.content === 'string') return record.content;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.message === 'string') return record.message;
  const data = record.data;
  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>;
    if (typeof nested.content === 'string') return nested.content;
    if (typeof nested.text === 'string') return nested.text;
  }
  if (typeof record.step === 'string' && record.step !== 'agent') {
    return `Update: ${record.step}`;
  }
  return null;
}

export function TaskPanelHeader({
  onBack,
  projectId,
  draftProject,
}: {
  onBack: () => void;
  projectId: string;
  draftProject?: WebProject | null;
}) {
  const appearance = useAuthStore((state) => state.appearance);
  const eigentIcon =
    appearance === 'dark' ? eigentAppIconWhite : eigentAppIconBlack;
  const { activeSpace } = useSpaces();
  const { project: loadedProject } = useProjectDetail(
    draftProject ? undefined : projectId
  );
  const project = draftProject ?? loadedProject;
  const projectName = project?.name ?? 'Project';

  return (
    <header className="h-12 shrink-0 bg-ds-bg-neutral-subtle-default px-3">
      <div className="flex h-full items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="md"
            buttonContent="icon-only"
            buttonRadius="full"
            aria-label="Back to projects"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <span className="truncate text-body-sm font-semibold text-ds-text-neutral-default-default">
            {activeSpace.name} / {projectName}
          </span>
        </div>

        <img
          src={eigentIcon}
          alt=""
          className="-mb-0.5 h-7 w-7 shrink-0 select-none"
          aria-hidden
        />
      </div>
    </header>
  );
}
