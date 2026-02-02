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

import { proxyFetchPost } from '@/api/http';
import { toast } from 'sonner';

export const share = async (taskId: string) => {
  try {
    const res = await proxyFetchPost(`/api/chat/share`, {
      task_id: taskId,
    });
    const shareLink = `${import.meta.env.VITE_USE_LOCAL_PROXY === 'true' ? 'eigent://callback' : 'https://www.eigent.ai/download'}?share_token=${res.share_token}__${taskId}`;
    navigator.clipboard
      .writeText(shareLink)
      .then(() => {
        toast.success('The share link has been copied.');
      })
      .catch((err) => {
        console.error('Failed to copy:', err);
      });
  } catch (error) {
    console.error('Failed to share task:', error);
  }
};
