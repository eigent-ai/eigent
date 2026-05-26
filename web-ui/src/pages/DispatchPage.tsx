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
        className="bg-ds-bg-neutral-default-default inset-0 min-h-0 absolute flex flex-col"
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
            className="bg-ds-bg-neutral-subtle-default inset-0 min-h-0 absolute flex flex-col"
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
          'min-h-0 flex flex-col',
          showTaskPanel
            ? 'border-ds-border-neutral-subtle-disabled w-[min(100%,380px)] shrink-0 border-r'
            : 'w-full flex-1'
        )}
      >
        <ProjectPanel
          activeProjectId={projectId}
          onSelectProject={onSelectProject}
        />
      </section>

      <div className="min-h-0 min-w-0 relative flex flex-1 overflow-hidden">
        {!showTaskPanel ? (
          <section className="text-ds-text-neutral-muted-default min-h-0 min-w-0 px-6 flex flex-1 items-center justify-center text-center">
            Select a project to open its task workspace.
          </section>
        ) : null}

        <AnimatePresence initial={false}>
          {showTaskPanel && projectId ? (
            <motion.section
              key={projectId}
              className="bg-ds-bg-neutral-subtle-default inset-0.5 min-h-0 absolute flex flex-col overflow-hidden rounded-[20px]"
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
    <div className="bg-ds-bg-neutral-strong-default flex h-full w-full overflow-hidden">
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
