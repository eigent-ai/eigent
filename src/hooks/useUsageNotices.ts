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

import { useAuthStore } from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';
import {
  refreshUsage,
  setUsageAccount,
  setUsageModelType,
} from '@/store/usageNoticeStore';
import { useEffect } from 'react';

export function useUsageNotices() {
  const account = useAuthStore((state) =>
    state.token && state.user_id != null ? String(state.user_id) : null
  );
  const defaultModelType = useAuthStore((state) => state.modelType);
  const pinnedModelType = useProjectStore((state) =>
    state.activeProjectId
      ? state.projects[state.activeProjectId]?.metadata?.modelSelection
          ?.modelType
      : undefined
  );
  const modelType = pinnedModelType ?? defaultModelType;
  useEffect(() => {
    setUsageAccount(account);
    setUsageModelType(modelType);
    if (!account || modelType !== 'cloud') return;
    const refresh = () => {
      void refreshUsage();
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [account, modelType]);
}
