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
// Client platform detection. See docs/design/04-client.md.

export type ClientType =
  | 'desktop'
  | 'web'
  | 'cli'
  | 'browser_extension'
  | 'whatsapp'
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'lark';

/** True when running inside Electron (desktop app). */
export function isElectron(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as any).electronAPI &&
    !!(window as any).ipcRenderer
  );
}

/** Current client type. Web build = 'web'; Electron = 'desktop'. */
export function getClientType(): ClientType {
  if (typeof window === 'undefined') return 'web';
  if (isElectron()) return 'desktop';
  return 'web';
}

export function isDesktop(): boolean {
  return getClientType() === 'desktop';
}

export function isWeb(): boolean {
  return getClientType() === 'web';
}
