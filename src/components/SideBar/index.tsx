import React, { useState } from "react";
import { MenuToggleGroup, MenuToggleItem } from "@/components/MenuButton/MenuButton";
import { FileDown, Inbox, LayoutGrid, MessageCircleQuestion, Network, Settings2Icon, ZapIcon, PinIcon } from "lucide-react";
import { TooltipSimple } from "@/components/ui/tooltip";
import giftIcon from "@/assets/gift.svg";

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


interface SideBarProps {
  className?: string;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function SideBar({ className, activeTab, onTabChange }: SideBarProps) {

  const menuItems = [
    { id: "tasks", icon: <PinIcon />, label: "Tasks" },
    { id: "trigger", icon: <ZapIcon />, label: "Trigger" },
    { id: "inbox", icon: <InboxIcon />, label: "Inbox" },
  ];

  return (
    <div className={`h-full flex flex-col items-center pr-1 pt-2 gap-1 ${className}`}>
      {/* Main menu items */}
      <div className="flex flex-col gap-1">
        <MenuToggleGroup type="single" orientation="vertical" value={activeTab} onValueChange={onTabChange}>
          {menuItems.map((item) => (
            <TooltipSimple key={item.id} content={item.label} side="right" delayDuration={0}>
              <span>
                <MenuToggleItem
                  value={item.id}
                  size="iconxs"
                  icon={item.icon}
                />
              </span>
            </TooltipSimple>
          ))}
        </MenuToggleGroup>
      </div>
    </div>
  );
}
