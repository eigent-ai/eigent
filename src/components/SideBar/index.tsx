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

import React, { useState } from "react";
import { MenuToggleGroup, MenuToggleItem } from "@/components/MenuButton/MenuButton";
import { FileDown, Inbox, LayoutGrid, MessageCircleQuestion, Network, Settings2Icon } from "lucide-react";
import giftIcon from "@/assets/gift.svg";
import giftWhiteIcon from "@/assets/gift-white.svg";
import { useAuthStore } from "@/store/authStore";

// Icons - you can replace these with actual icon components
const HomeIcon = () => (
  <LayoutGrid/>
);

const WorkflowIcon = () => (
  <Network/>  
);

const InboxIcon = () => (
  <Inbox/>
);

const SettingsIcon = () => (
  <Settings2Icon/>
);

const BugIcon = () => (
  <FileDown/>
);

const SupportIcon = () => (
  <MessageCircleQuestion/>
);

interface SideBarProps {
  className?: string;
}

export default function SideBar({ className }: SideBarProps) {
  const [activeItem, setActiveItem] = useState("home");
  const { appearance } = useAuthStore();

  const menuItems = [
    { id: "home", icon: <HomeIcon />, label: "Home" },
    { id: "workflow", icon: <WorkflowIcon />, label: "Workflow" },
    { id: "inbox", icon: <InboxIcon />, label: "Inbox" },
    { id: "settings", icon: <SettingsIcon />, label: "Settings" },
  ];

  const bottomItems = [
    { id: "bug", icon: <BugIcon />, label: "Bug" },
    {
      id: "refer",
      icon: (
        <img
          src={appearance === "light" ? giftIcon : giftWhiteIcon}
          alt="gift-icon"
          className="w-[20px] h-[20px]"
        />
      ),
      label: "Refer",
    },
    { id: "support", icon: <SupportIcon />, label: "Support" },
  ];

  return (
    <div className={`h-full flex flex-col items-center pl-1 gap-1 ${className}`}>
      {/* Main menu items */}
      <div className="flex flex-col gap-1">
        <MenuToggleGroup type="single" orientation="vertical" value={activeItem} onValueChange={setActiveItem}>
          {menuItems.map((item) => (
            <MenuToggleItem
              key={item.id}
              value={item.id}
              size="sm"
              icon={item.icon}
            />
          ))}
        </MenuToggleGroup>
      </div>

      {/* Bottom menu items */}
      <div className="flex-1 flex flex-col justify-end">
        <MenuToggleGroup type="single" orientation="vertical" value={activeItem} onValueChange={setActiveItem}>
          {bottomItems.map((item) => (
            <MenuToggleItem
              key={item.id}
              value={item.id}
              size="sm"
              icon={item.icon}
            />
          ))}
        </MenuToggleGroup>
      </div>
    </div>
  );
}
