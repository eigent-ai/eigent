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

import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useTranslation } from 'react-i18next';
import { WorkSpaceMenu } from '../WorkspaceMenu';

interface BottomBarProps {
  onToggleChatBox?: () => void;
  isChatBoxVisible?: boolean;
}

// Red dot notification indicator
const RedDotIcon = () => (
  <div className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
);

function BottomBar({ onToggleChatBox, isChatBoxVisible }: BottomBarProps) {
  const { t } = useTranslation();
  const { chatStore } = useChatStoreAdapter();

  // Check if there are new files
  const nuwFileNum = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]?.nuwFileNum || 0
    : 0;
  const hasNewFiles = nuwFileNum > 0;

  // Handle inbox click and reset notification
  const handleInboxClick = () => {
    if (chatStore?.activeTaskId) {
      // Reset the new file counter when user views inbox
      chatStore.setNuwFileNum(chatStore.activeTaskId, 0);
      // Set active workspace to inbox
      chatStore.setActiveWorkspace(chatStore.activeTaskId, 'inbox');
    }
  };

  const activeWorkspace = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]?.activeWorkspace
    : null;

  return (
    <div className="relative z-50 flex h-12 items-center justify-center pt-2">
      <WorkSpaceMenu
        onToggleChatBox={onToggleChatBox}
        isChatBoxVisible={isChatBoxVisible}
      />
    </div>
  );
}

export default BottomBar;
