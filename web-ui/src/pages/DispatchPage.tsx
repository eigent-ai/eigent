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

import { cn } from '@/lib/utils';
import { ProjectPanel } from '@web/components/dispatch/ProjectPanel';
import {
  TaskChatView,
  TaskPanelHeader,
} from '@web/components/dispatch/TaskPanel';
import { useIsMobile } from '@web/hooks/useWebAuth';
import type { WebProject } from '@web/types';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

const DISPATCH_PANEL_TRANSITION = {
  type: 'spring',
  stiffness: 380,
  damping: 38,
  mass: 0.85,
} as const;

function TaskPanelSection({
  projectId,
  draftProject,
  onBack,
}: {
  projectId: string;
  draftProject?: WebProject | null;
  onBack: () => void;
}) {
  return (
    <>
      <TaskPanelHeader
        onBack={onBack}
        projectId={projectId}
        draftProject={draftProject}
      />
      <TaskChatView projectId={projectId} draftProject={draftProject} />
    </>
  );
}

function MobileDispatchLayout({
  showTaskPanel,
  projectId,
  draftProject,
  onSelectProject,
  onBack,
}: {
  showTaskPanel: boolean;
  projectId?: string;
  draftProject?: WebProject | null;
  onSelectProject: (id: string) => void;
  onBack: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion ? { duration: 0 } : DISPATCH_PANEL_TRANSITION;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <motion.section
        className="absolute inset-0 flex min-h-0 flex-col bg-ds-bg-neutral-default-default"
        initial={false}
        animate={{ x: showTaskPanel ? '-100%' : '0%' }}
        transition={transition}
      >
        <ProjectPanel
          activeProjectId={projectId}
          onSelectProject={onSelectProject}
        />
      </motion.section>

      <AnimatePresence initial={false}>
        {showTaskPanel && projectId ? (
          <motion.section
            key={projectId}
            className="absolute inset-0 flex min-h-0 flex-col bg-ds-bg-neutral-subtle-default"
            initial={reduceMotion ? false : { x: '100%' }}
            animate={{ x: 0 }}
            exit={reduceMotion ? undefined : { x: '100%' }}
            transition={transition}
          >
            <TaskPanelSection
              projectId={projectId}
              draftProject={draftProject}
              onBack={onBack}
            />
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function DesktopDispatchLayout({
  showTaskPanel,
  projectId,
  draftProject,
  onSelectProject,
  onBack,
}: {
  showTaskPanel: boolean;
  projectId?: string;
  draftProject?: WebProject | null;
  onSelectProject: (id: string) => void;
  onBack: () => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <>
      <section
        className={cn(
          'flex min-h-0 flex-col',
          showTaskPanel
            ? 'w-[min(100%,380px)] shrink-0 border-r border-ds-border-neutral-subtle-disabled'
            : 'w-full flex-1'
        )}
      >
        <ProjectPanel
          activeProjectId={projectId}
          onSelectProject={onSelectProject}
        />
      </section>

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {!showTaskPanel ? (
          <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-6 text-center text-ds-text-neutral-muted-default">
            Select a project to open its task workspace.
          </section>
        ) : null}

        <AnimatePresence initial={false}>
          {showTaskPanel && projectId ? (
            <motion.section
              key={projectId}
              className="absolute inset-0.5 flex min-h-0 flex-col overflow-hidden rounded-[20px] bg-ds-bg-neutral-subtle-default"
              initial={reduceMotion ? false : { x: '100%' }}
              animate={{ x: 0 }}
              exit={reduceMotion ? undefined : { x: '100%' }}
              transition={
                reduceMotion ? { duration: 0 } : DISPATCH_PANEL_TRANSITION
              }
            >
              <TaskPanelSection
                projectId={projectId}
                draftProject={draftProject}
                onBack={onBack}
              />
            </motion.section>
          ) : null}
        </AnimatePresence>
      </div>
    </>
  );
}

export default function DispatchPage() {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const draftProject = (location.state as { draftProject?: WebProject } | null)
    ?.draftProject;

  const showTaskPanel = Boolean(projectId);

  const handleSelectProject = (id: string) => {
    navigate(`/projects/${id}`);
  };

  const handleBackToProjects = () => {
    navigate('/projects');
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-ds-bg-neutral-strong-default">
      {isMobile ? (
        <MobileDispatchLayout
          showTaskPanel={showTaskPanel}
          projectId={projectId}
          draftProject={draftProject}
          onSelectProject={handleSelectProject}
          onBack={handleBackToProjects}
        />
      ) : (
        <DesktopDispatchLayout
          showTaskPanel={showTaskPanel}
          projectId={projectId}
          draftProject={draftProject}
          onSelectProject={handleSelectProject}
          onBack={handleBackToProjects}
        />
      )}
    </div>
  );
}
