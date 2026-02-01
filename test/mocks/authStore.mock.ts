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

import { vi } from 'vitest';

vi.mock('../../src/store/authStore', () => ({
  useAuthStore: {
    token: null,
    username: null,
    email: null,
    user_id: null,
    appearance: 'light',
    language: 'system',
    isFirstLaunch: true,
    modelType: 'cloud' as const,
    cloud_model_type: 'gpt-4.1' as const,
    initState: 'permissions' as const,
    share_token: null,
    workerListData: {},
  },
  getAuthStore: vi.fn(() => ({
    token: null,
    username: null,
    email: null,
    user_id: null,
    appearance: 'light',
    language: 'system',
    isFirstLaunch: true,
    modelType: 'cloud' as const,
    cloud_model_type: 'gpt-4.1' as const,
    initState: 'permissions' as const,
    share_token: null,
    workerListData: {},
  })),
  useWorkerList: vi.fn(() => []),
}));
