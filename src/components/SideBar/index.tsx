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

import {
  MenuToggleGroup,
  MenuToggleItem,
} from '@/components/MenuButton/MenuButton';
import { TooltipSimple } from '@/components/ui/tooltip';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import {
  FileDown,
  Inbox,
  LayoutGrid,
  Network,
  PinIcon,
  Settings2Icon,
  ZapIcon,
} from 'lucide-react';

// Icons - you can replace these with actual icon components
const HomeIcon = () => <LayoutGrid />;

const WorkflowIcon = () => <Network />;

const InboxIcon = () => <Inbox />;

const SettingsIcon = () => <Settings2Icon />;

const BugIcon = () => <FileDown />;

// Red dot notification indicator
const RedDotIcon = () => (
  <div className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
);

interface SideBarProps {
  className?: string;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function SideBar({
  className,
  activeTab,
  onTabChange,
}: SideBarProps) {
  const { chatStore } = useChatStoreAdapter();

  const menuItems = [
    { id: 'tasks', icon: <PinIcon />, label: 'Tasks' },
    { id: 'trigger', icon: <ZapIcon />, label: 'Trigger' },
    { id: 'inbox', icon: <InboxIcon />, label: 'Inbox' },
  ];

  // Check if there are new files
  const nuwFileNum = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]?.nuwFileNum || 0
    : 0;

  const hasNewFiles = nuwFileNum > 0;

  // Handle tab change and reset notification when inbox is clicked
  const handleTabChange = (tab: string) => {
    if (tab === 'inbox' && chatStore?.activeTaskId) {
      // Reset the new file counter when user views inbox
      chatStore.setNuwFileNum(chatStore.activeTaskId, 0);
    }
    onTabChange(tab);
  };

  return (
    <div
      className={`flex h-full flex-col items-center gap-1 pr-1 pt-2 ${className}`}
    >
      {/* Main menu items */}
      <div className="flex flex-col gap-1">
        <MenuToggleGroup
          type="single"
          orientation="vertical"
          value={activeTab}
          onValueChange={handleTabChange}
        >
          {menuItems.map((item) => (
            <TooltipSimple
              key={item.id}
              content={item.label}
              side="right"
              delayDuration={0}
            >
              <span>
                <MenuToggleItem
                  value={item.id}
                  size="iconxs"
                  icon={item.icon}
                  subIcon={
                    item.id === 'inbox' && hasNewFiles ? (
                      <RedDotIcon />
                    ) : undefined
                  }
                  showSubIcon={item.id === 'inbox' && hasNewFiles}
                />
              </span>
            </TooltipSimple>
          ))}
        </MenuToggleGroup>
      </div>
    </div>
  );
}
