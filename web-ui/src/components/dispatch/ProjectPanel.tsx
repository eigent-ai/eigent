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
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DispatchMenuPanel } from '@web/components/dispatch/DispatchMenuPanel';
import { ProjectPanelSettings } from '@web/components/dispatch/ProjectPanelSettings';
import { ProjectList } from '@web/components/projects/ProjectList';
import { createEmptyProject } from '@web/hooks/useProjectDetail';
import { useProjects } from '@web/hooks/useProjects';
import { useSpaces } from '@web/hooks/useSpaces';
import { isWebUiMock } from '@web/lib/mockMode';
import { createMockProjectGroup } from '@web/mock/state';
import { Folder, Menu, Plus, Search, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function ProjectPanelHeader({ onAddTask }: { onAddTask: () => void }) {
  const { activeSpace } = useSpaces();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="mx-2 my-1 h-12 shrink-0 rounded-2xl bg-ds-bg-neutral-subtle-default px-1">
        <div className="grid h-full grid-cols-[auto_1fr_auto] items-center gap-2">
          <Button
            variant="ghost"
            size="md"
            buttonContent="icon-only"
            buttonRadius="full"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu />
          </Button>

          <div className="flex min-w-0 justify-start">
            <span className="truncate text-body-sm font-semibold text-ds-text-neutral-default-default">
              {activeSpace.name}
            </span>
          </div>

          <Button
            variant="primary"
            size="sm"
            buttonContent="text"
            buttonRadius="full"
            className="w-fit shrink-0"
            onClick={onAddTask}
          >
            <Plus />
            New Task
          </Button>
        </div>
      </header>

      <DispatchMenuPanel open={menuOpen} onOpenChange={setMenuOpen} />
    </>
  );
}

export function ProjectPanel({
  activeProjectId,
  onSelectProject,
}: {
  activeProjectId?: string;
  onSelectProject: (projectId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const { projects, allProjects, loading, error, reload } = useProjects(search);
  const navigate = useNavigate();

  const handleAddTask = () => {
    const project = createEmptyProject('New task');
    if (isWebUiMock()) {
      createMockProjectGroup(project.name, project.projectId);
    }
    onSelectProject(project.projectId);
    navigate(`/projects/${project.projectId}`, {
      state: { draftProject: project },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-ds-bg-neutral-strong-default">
      <ProjectPanelHeader onAddTask={handleAddTask} />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-4">
        <Tabs
          defaultValue="projects"
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabsList className="w-full shrink-0">
            <TabsTrigger value="projects" className="flex-1">
              <span className="flex items-center gap-2 !text-body-sm text-ds-text-neutral-default-default">
                <Folder className="h-4 w-4 shrink-0" aria-hidden />
                Projects
              </span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex-1">
              <span className="flex items-center gap-2 !text-body-sm text-ds-text-neutral-default-default">
                <Settings2 className="h-4 w-4 shrink-0" aria-hidden />
                Settings
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="projects"
            className="scrollbar-always-visible mt-0 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden data-[state=inactive]:hidden"
          >
            <div className="relative mb-0.5 mt-0.5 min-w-0 shrink-0">
              <Input
                id="project-panel-search"
                type="search"
                size="sm"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search projects…"
                aria-label="Search projects"
                leadingIcon={
                  <Search className="h-4 w-4 text-ds-icon-neutral-muted-default" />
                }
              />
            </div>

            <ProjectList
              projects={projects}
              loading={loading}
              error={error}
              activeProjectId={activeProjectId}
              onSelectProject={onSelectProject}
              onCreate={handleAddTask}
              showNewSession={false}
              searchQuery={search}
              hasUnfilteredProjects={allProjects.length > 0}
            />

            {error ? (
              <div className="mt-4 flex shrink-0 justify-center">
                <Button
                  variant="outline"
                  size="md"
                  buttonContent="text"
                  onClick={() => void reload()}
                >
                  Retry
                </Button>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent
            value="settings"
            className="scrollbar-always-visible mx-2 mt-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden data-[state=inactive]:hidden"
          >
            <ProjectPanelSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
