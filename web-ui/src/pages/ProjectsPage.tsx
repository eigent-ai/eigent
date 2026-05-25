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
import { ProjectList } from '@web/components/projects/ProjectList';
import { createEmptyProject } from '@web/hooks/useProjectDetail';
import { useProjects } from '@web/hooks/useProjects';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ProjectsPage() {
  const [search, setSearch] = useState('');
  const { projects, loading, error, reload } = useProjects(search);
  const navigate = useNavigate();

  const handleCreate = () => {
    const project = createEmptyProject('New project');
    navigate(`/projects/${project.projectId}`, {
      state: { draftProject: project },
    });
  };

  return (
    <div className="gap-4 flex h-full w-full flex-col overflow-y-auto">
      <div className="gap-3 sm:flex-row sm:items-center sm:justify-between flex flex-col">
        <div>
          <h1 className="text-heading-md font-semibold text-ds-text-neutral-default-default">
            Projects
          </h1>
          <p className="text-body-md text-ds-text-neutral-muted-default">
            Browse and open projects for remote control.
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="mr-2 h-4 w-4" />
          New project
        </Button>
      </div>

      <div className="max-w-xl relative">
        <Search className="left-3 h-4 w-4 text-ds-icon-neutral-muted-default pointer-events-none absolute top-1/2 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search projects and sessions…"
          className="pl-9"
        />
      </div>

      <ProjectList
        projects={projects}
        loading={loading}
        error={error}
        onCreate={handleCreate}
      />

      {error ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
