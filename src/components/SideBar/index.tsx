import React, { useState } from "react";
import { MenuToggleGroup, MenuToggleItem } from "@/components/MenuButton/MenuButton";
import { FileDown, Inbox, LayoutGrid, MessageCircleQuestion, Network, Settings2Icon, ZapIcon, PinIcon } from "lucide-react";
import { TooltipSimple } from "@/components/ui/tooltip";
import giftIcon from "@/assets/gift.svg";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

// Icons - you can replace these with actual icon components
const HomeIcon = () => (
  <LayoutGrid />
);

const WorkflowIcon = () => (
  <Network />
);

const InboxIcon = () => (
  <Inbox />
);

const SettingsIcon = () => (
  <Settings2Icon />
);

const BugIcon = () => (
  <FileDown />
);

// Red dot notification indicator
const RedDotIcon = () => (
  <div className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
);


interface SideBarProps {
  className?: string;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function SideBar({ className, activeTab, onTabChange }: SideBarProps) {
  const { chatStore } = useChatStoreAdapter();

  // Check if there are new files
  const nuwFileNum = chatStore?.activeTaskId
    ? (chatStore.tasks[chatStore.activeTaskId]?.nuwFileNum || 0)
    : 0;

  const hasNewFiles = nuwFileNum > 0;

  // Handle tab change and reset notification when inbox is clicked
  const handleTabChange = (tab: string) => {
    if (tab === "inbox" && chatStore?.activeTaskId) {
      // Reset the new file counter when user views inbox
      chatStore.setNuwFileNum(chatStore.activeTaskId, 0);
    }
    onTabChange(tab);
  };

  const menuItems = [
    { id: "tasks", icon: <PinIcon />, label: "Tasks" },
    { id: "trigger", icon: <ZapIcon />, label: "Trigger" },
    { id: "inbox", icon: <InboxIcon />, label: "Inbox" },
  ];

  return (
    <div className={`h-full flex flex-col items-center pr-1 pt-2 gap-1 ${className}`}>
      {/* Main menu items */}
      <div className="flex flex-col gap-1">
        <MenuToggleGroup type="single" orientation="vertical" value={activeTab} onValueChange={handleTabChange}>
          {menuItems.map((item) => (
            <TooltipSimple key={item.id} content={item.label} side="right" delayDuration={0}>
              <span>
                <MenuToggleItem
                  value={item.id}
                  size="iconxs"
                  icon={item.icon}
                  subIcon={item.id === "inbox" && hasNewFiles ? <RedDotIcon /> : undefined}
                  showSubIcon={item.id === "inbox" && hasNewFiles}
                />
              </span>
            </TooltipSimple>
          ))}
        </MenuToggleGroup>
      </div>
    </div>
  );
}
