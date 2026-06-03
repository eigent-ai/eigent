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

import VerticalNavigation, {
  HISTORY_VERTICAL_SIDEBAR_CLASSNAME,
  type VerticalNavItem,
} from '@/components/Dashboard/VerticalNav';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Memory from './Memory';
import Models from './Models';
import Skills from './Skills';
import SubAgents from './SubAgents';

const AGENT_SECTIONS = ['models', 'skills', 'sub-agents', 'memory'] as const;
type AgentSection = (typeof AGENT_SECTIONS)[number];

function isAgentSection(value: string | null): value is AgentSection {
  return value !== null && AGENT_SECTIONS.includes(value as AgentSection);
}

export default function Capabilities() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sectionFromUrl = searchParams.get('section');

  const [activeTab, setActiveTab] = useState<AgentSection>(() =>
    isAgentSection(sectionFromUrl) ? sectionFromUrl : 'models'
  );

  useEffect(() => {
    if (isAgentSection(sectionFromUrl)) {
      setActiveTab(sectionFromUrl);
    }
  }, [sectionFromUrl]);

  const menuItems = [
    {
      id: 'models',
      name: t('setting.models'),
    },
    {
      id: 'skills',
      name: t('agents.skills'),
    },
    {
      id: 'sub-agents',
      name: t('agents.sub-agents'),
    },
    {
      id: 'memory',
      name: t('agents.memory'),
    },
  ];

  const handleTabChange = (tabId: string) => {
    if (!AGENT_SECTIONS.includes(tabId as AgentSection)) return;
    setActiveTab(tabId as AgentSection);
    navigate(`?tab=agents&section=${tabId}`, { replace: true });
  };

  return (
    <div className="flex h-auto w-full">
      <div className={HISTORY_VERTICAL_SIDEBAR_CLASSNAME}>
        <VerticalNavigation
          items={
            menuItems.map((menu) => ({
              value: menu.id,
              label: (
                <span className="w-full text-left text-body-sm font-bold">
                  {menu.name}
                </span>
              ),
            })) as VerticalNavItem[]
          }
          value={activeTab}
          onValueChange={handleTabChange}
          className="h-full min-h-0 w-full flex-1 gap-0"
          listClassName="w-full h-full overflow-y-auto"
          contentClassName="hidden"
        />
      </div>

      <div className="flex h-auto w-full flex-1 flex-col">
        <div className="flex flex-col gap-4">
          {activeTab === 'models' && <Models />}
          {activeTab === 'skills' && <Skills />}
          {activeTab === 'sub-agents' && <SubAgents />}
          {activeTab === 'memory' && <Memory />}
        </div>
      </div>
    </div>
  );
}
