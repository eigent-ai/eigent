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

export const SITE_URL =
  import.meta.env.VITE_SITE_URL || 'https://www.eigent.ai';

export function getProxyBaseURL() {
  const isDev = import.meta.env.DEV;

  if (isDev) {
    const proxyUrl = import.meta.env.VITE_PROXY_URL;
    if (!proxyUrl) {
      return 'http://localhost:3001';
    }
    return proxyUrl;
  } else {
    const useLocalProxy = import.meta.env.VITE_USE_LOCAL_PROXY === 'true';
    const proxyUrl = import.meta.env.VITE_PROXY_URL;
    const baseUrl =
      !useLocalProxy && proxyUrl
        ? proxyUrl
        : import.meta.env.VITE_BASE_URL || proxyUrl;
    if (!baseUrl) {
      throw new Error('VITE_BASE_URL or VITE_PROXY_URL is not configured');
    }
    return String(baseUrl).replace(/\/$/, '');
  }
}

export function generateUniqueId(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `${timestamp}-${random}`;
}

export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number,
  immediate: boolean = false
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function (this: any, ...args: Parameters<T>) {
    const context = this;

    const later = () => {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };

    const callNow = immediate && !timeout;

    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);

    if (callNow) func.apply(context, args);
  };
}

export function capitalizeFirstLetter(input: string): string {
  if (input.length === 0) return input;
  return input.charAt(0).toUpperCase() + input.slice(1);
}

export function hasStackKeys() {
  return (
    import.meta.env.VITE_STACK_PROJECT_ID &&
    import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY &&
    import.meta.env.VITE_STACK_SECRET_SERVER_KEY
  );
}

// Re-export replay utilities
export { buildTaskQuestionsById } from './historyPrompts';
export {
  computeProjectFreshnessAnchor,
  loadProjectFromHistory,
  replayProject,
} from './replay';

export async function uploadLog(taskId: string, type?: string | undefined) {
  if (import.meta.env.VITE_USE_LOCAL_PROXY !== 'true' && !type) {
    try {
      const [{ createHost }, { getAuthStore }] = await Promise.all([
        import('@/host'),
        import('@/store/authStore'),
      ]);
      const { email, token } = getAuthStore();
      const electronAPI = createHost().electronAPI;
      const baseUrl = import.meta.env.DEV
        ? import.meta.env.VITE_PROXY_URL
        : import.meta.env.VITE_BASE_URL;

      await electronAPI?.uploadLog(email, taskId, baseUrl, token);
    } catch (error) {
      console.error('Failed to upload log:', error);
    }
  }
}
