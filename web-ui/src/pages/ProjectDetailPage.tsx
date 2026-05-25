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
import { sendProjectMessage } from '@web/api/brain';
import { MessageComposer } from '@web/components/project/MessageComposer';
import { SessionList } from '@web/components/project/SessionList';
import { SessionReview } from '@web/components/project/SessionReview';
import { SessionSidePanel } from '@web/components/project/SessionSidePanel';
import { useProjectDetail, useSessionPanel } from '@web/hooks/useProjectDetail';
import { useIsMobile } from '@web/hooks/useWebAuth';
import type { WebProject } from '@web/types';
import { ArrowLeft, PanelRightOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

function extractLiveMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.content === 'string') return record.content;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.message === 'string') return record.message;
  if (record.data && typeof record.data === 'object') {
    const data = record.data as Record<string, unknown>;
    if (typeof data.content === 'string') return data.content;
    if (typeof data.text === 'string') return data.text;
  }
  if (typeof record.step === 'string' && record.step !== 'agent') {
    return `Update: ${record.step}`;
  }
  return null;
}

export default function ProjectDetailPage() {
  const { projectId, taskId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const draftProject = (location.state as { draftProject?: WebProject } | null)
    ?.draftProject;

  const {
    project: loadedProject,
    loading,
    error,
    reload,
  } = useProjectDetail(draftProject ? undefined : projectId);

  const project = draftProject ?? loadedProject;
  const activeTaskId = taskId ?? project?.sessions[0]?.taskId;
  const activeSession =
    project?.sessions.find((session) => session.taskId === activeTaskId) ??
    null;

  const { panel, loading: panelLoading } = useSessionPanel(
    project,
    activeTaskId
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const [liveMessages, setLiveMessages] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setLiveMessages([]);
  }, [activeTaskId]);

  const handleSend = useCallback(
    (message: string) => {
      if (!projectId && !project) return;
      const resolvedProjectId = project?.projectId ?? projectId!;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLiveMessages([]);

      const newTaskId = sendProjectMessage({
        projectId: resolvedProjectId,
        question: message,
        signal: controller.signal,
        onEvent: (payload) => {
          const text = extractLiveMessage(payload);
          if (text) {
            setLiveMessages((prev) => [...prev, text]);
          }
        },
        onDone: () => void reload(),
      });

      navigate(`/projects/${resolvedProjectId}/sessions/${newTaskId}`);
      void reload();
    },
    [project, projectId, navigate, reload]
  );

  const title = useMemo(() => project?.name ?? 'Project', [project?.name]);

  if (!draftProject && loading) {
    return (
      <div className="text-ds-text-neutral-muted-default flex h-full w-full items-center justify-center">
        Loading project…
      </div>
    );
  }

  if (!draftProject && error) {
    return (
      <div className="gap-3 flex h-full w-full flex-col items-center justify-center">
        <p className="text-ds-text-error-default-default">{error}</p>
        <Button variant="outline" onClick={() => void reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-ds-text-neutral-muted-default flex h-full w-full items-center justify-center">
        Project not found.
      </div>
    );
  }

  return (
    <div className="gap-4 flex h-full w-full flex-col overflow-hidden">
      <div className="gap-3 flex flex-wrap items-center justify-between">
        <div className="gap-3 flex items-center">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/projects" aria-label="Back to projects">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-heading-md font-semibold text-ds-text-neutral-default-default">
              {title}
            </h1>
            <p className="text-body-sm text-ds-text-neutral-muted-default">
              {project.sessionCount} sessions ·{' '}
              {project.totalTokens.toLocaleString()} tokens
            </p>
          </div>
        </div>
        {isMobile ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPanelOpen(true)}
          >
            <PanelRightOpen className="mr-2 h-4 w-4" />
            Details
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px] grid flex-1">
        <section className="min-h-0 rounded-xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-4 overflow-y-auto border">
          <h2 className="mb-3 text-heading-sm font-semibold text-ds-text-neutral-default-default">
            Sessions
          </h2>
          <SessionList project={project} activeTaskId={activeTaskId} />
        </section>

        <section className="min-h-0 gap-4 flex flex-col">
          <div className="min-h-0 flex-1">
            <SessionReview
              session={activeSession}
              liveMessages={liveMessages}
              onControl={() => void reload()}
            />
          </div>
          <MessageComposer onSend={handleSend} />
        </section>

        {!isMobile ? (
          <SessionSidePanel data={panel} loading={panelLoading} />
        ) : null}
      </div>

      {isMobile && panelOpen ? (
        <div className="inset-0 fixed z-50 flex">
          <button
            type="button"
            aria-label="Close session panel overlay"
            className="inset-0 bg-black/40 absolute"
            onClick={() => setPanelOpen(false)}
          />
          <div className="max-w-md p-4 relative z-10 ml-auto flex h-full w-full flex-col">
            <SessionSidePanel
              data={panel}
              loading={panelLoading}
              onClose={() => setPanelOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
