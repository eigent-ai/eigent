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
    <div className="flex h-full w-full flex-col overflow-y-auto">
      <div className="flex-1">
        <div className="max-w-xl mb-4 relative">
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
          onSelectProject={(projectId) => navigate(`/projects/${projectId}`)}
          onCreate={handleCreate}
        />

        {error ? (
          <div className="mt-4 flex justify-center">
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
      </div>

      <div className="bottom-0 px-4 py-4 sticky z-10 flex justify-center">
        <Button
          variant="primary"
          size="md"
          buttonContent="text"
          buttonRadius="full"
          className="w-fit"
          onClick={handleCreate}
        >
          <Plus />
          New project
        </Button>
      </div>
    </div>
  );
}
