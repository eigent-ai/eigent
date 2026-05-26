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

import { BASE_WORKFLOW_AGENTS } from '@/components/WorkFlow/baseWorkers';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useSpaces } from '@web/hooks/useSpaces';
import { Bot, FolderOpen } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

const DEFAULT_SINGLE_AGENT: Agent = {
  agent_id: 'camel-agent',
  name: 'CAMEL Agent',
  type: 'single_agent',
  tasks: [],
  tools: [],
  log: [],
  activeWebviewIds: [],
};

function AgentListItem({ name }: { name: string }) {
  return (
    <div className="gap-3 rounded-xl bg-ds-bg-neutral-default-default px-3 py-2.5 flex items-center">
      <div className="h-8 w-8 rounded-lg bg-ds-bg-neutral-strong-default flex shrink-0 items-center justify-center">
        <Bot
          className="h-4 w-4 text-ds-icon-neutral-muted-default"
          aria-hidden
        />
      </div>
      <span className="min-w-0 text-body-sm font-medium text-ds-text-neutral-default-default flex-1 truncate">
        {name}
      </span>
    </div>
  );
}

function SettingsSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('gap-2 flex flex-col', className)}>
      <h3 className="text-body-sm font-semibold text-ds-text-neutral-default-default">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ProjectPanelSettings() {
  const { activeSpace } = useSpaces();
  const email = useAuthStore((state) => state.email);
  const workerListData = useAuthStore((state) => state.workerListData);
  const workerList = useMemo(
    () => workerListData[email ?? ''] ?? [],
    [workerListData, email]
  );

  const singleAgents = useMemo(() => {
    const custom = workerList.filter((agent) => agent.type === 'single_agent');
    return custom.length > 0 ? custom : [DEFAULT_SINGLE_AGENT];
  }, [workerList]);

  const workforceAgents = useMemo(() => {
    const baseIds = new Set(
      BASE_WORKFLOW_AGENTS.map((agent) => agent.agent_id)
    );
    const custom = workerList.filter(
      (agent) => agent.type !== 'single_agent' && !baseIds.has(agent.agent_id)
    );
    return [...BASE_WORKFLOW_AGENTS, ...custom];
  }, [workerList]);

  return (
    <div className="gap-6 pb-2 flex flex-col">
      <SettingsSection title="Single Agent">
        <div className="gap-2 flex flex-col">
          {singleAgents.map((agent) => (
            <AgentListItem key={agent.agent_id} name={agent.name} />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Workforce">
        <div className="gap-2 flex flex-col">
          {workforceAgents.map((agent) => (
            <AgentListItem key={agent.agent_id} name={agent.name} />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Space Folder path">
        <div className="gap-3 rounded-xl bg-ds-bg-neutral-default-default px-3 py-2.5 flex items-start">
          <div className="h-8 w-8 rounded-lg bg-ds-bg-neutral-strong-default flex shrink-0 items-center justify-center">
            <FolderOpen
              className="h-4 w-4 text-ds-icon-neutral-muted-default"
              aria-hidden
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-body-sm text-ds-text-neutral-default-default truncate">
              /{activeSpace.folderPath.replace(/^~\//, '')}
            </p>
            <p className="mt-0.5 text-body-xs text-ds-text-neutral-muted-default">
              Current space: {activeSpace.name}
            </p>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
