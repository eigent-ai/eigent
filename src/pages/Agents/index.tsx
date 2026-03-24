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
  type VerticalNavItem,
} from '@/components/Navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Memory from './Memory';
import Models from './Models';
import Skills from './Skills';

const AGENT_SECTIONS = ['models', 'skills', 'memory'] as const;
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
    <div className="m-auto flex h-auto max-w-[940px] flex-col">
      <div className="px-6 flex h-auto w-full">
        <div className="top-20 w-40 pr-6 pt-8 sticky flex h-full flex-shrink-0 flex-grow-0 flex-col justify-between self-start">
          <VerticalNavigation
            items={
              menuItems.map((menu) => ({
                value: menu.id,
                label: (
                  <span className="text-body-sm font-bold">{menu.name}</span>
                ),
              })) as VerticalNavItem[]
            }
            value={activeTab}
            onValueChange={handleTabChange}
            className="min-h-0 gap-0 h-full w-full flex-1"
            listClassName="w-full h-full overflow-y-auto"
            contentClassName="hidden"
          />
        </div>

        <div className="flex h-auto w-full flex-1 flex-col">
          <div className="gap-4 flex flex-col">
            {activeTab === 'models' && <Models />}
            {activeTab === 'skills' && <Skills />}
            {activeTab === 'memory' && <Memory />}
          </div>
        </div>
      </div>
    </div>
  );
}
