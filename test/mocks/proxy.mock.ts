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

// Mock API calls for both relative and alias paths
const mockImplementation = {
  fetchPost: vi.fn((url, _data) => {
    if (url.includes('/task/')) {
      return Promise.resolve({ success: true });
    }
    return Promise.resolve({});
  }),
  fetchPut: vi.fn(() => Promise.resolve({ success: true })),
  getBaseURL: vi.fn(() => Promise.resolve('http://localhost:8000')),
  proxyFetchPost: vi.fn((url, _data) => {
    // Mock history creation
    if (url.includes('/api/chat/history')) {
      return Promise.resolve({ id: 'history-' + Date.now() });
    }
    // Mock provider info
    if (url.includes('/api/providers')) {
      return Promise.resolve({ items: [] });
    }
    return Promise.resolve({});
  }),
  proxyFetchPut: vi.fn(() => Promise.resolve({ success: true })),
  proxyFetchGet: vi.fn((url, _params) => {
    // Mock user key
    if (url.includes('/api/user/key')) {
      return Promise.resolve({
        value: 'test-api-key',
        api_url: 'https://api.openai.com',
      });
    }
    // Mock providers
    if (url.includes('/api/providers')) {
      return Promise.resolve({ items: [] });
    }
    // Mock privacy settings
    if (url.includes('/api/user/privacy')) {
      return Promise.resolve({
        dataCollection: true,
        analytics: true,
        marketing: true,
      });
    }
    // Mock configs
    if (url.includes('/api/configs')) {
      return Promise.resolve([]);
    }
    // Mock snapshots - return empty array to prevent the error
    if (url.includes('/api/chat/snapshots')) {
      return Promise.resolve([]);
    }
    return Promise.resolve({});
  }),
  uploadFile: vi.fn(),
  fetchDelete: vi.fn(),
};

// Mock both relative and alias paths
vi.mock('../../src/api/http', () => mockImplementation);
vi.mock('@/api/http', () => mockImplementation);

// Export the mocked functions for use in tests
export const { proxyFetchGet, proxyFetchPost, fetchPost } = mockImplementation;
