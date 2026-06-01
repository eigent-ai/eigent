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

import { ChatTaskStatus } from '@/types/constants';
import { WebTaskMessageList } from '@web/components/dispatch/WebTaskMessageList';
import { MessageComposer } from '@web/components/project/MessageComposer';
import { useMemo, useState } from 'react';

export function WebTaskChatBox() {
  const [messages, setMessages] = useState<
    Array<{ id: string; role: 'user' | 'agent'; content: string }>
  >([]);
  const task = useMemo(
    () => ({
      status: ChatTaskStatus.FINISHED,
      taskTime: 0,
      elapsed: 0,
      messages,
    }),
    [messages]
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden p-3">
      <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto">
        <WebTaskMessageList task={task} />
      </div>
      <MessageComposer
        onSend={(content) => {
          setMessages((prev) => [
            ...prev,
            { id: `${Date.now()}-user`, role: 'user', content },
          ]);
        }}
      />
    </div>
  );
}
