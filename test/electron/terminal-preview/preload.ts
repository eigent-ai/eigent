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

import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('electronAPI', {
  terminalCreate: (options: unknown) =>
    ipcRenderer.invoke('terminal-create', options),
  terminalInput: (id: string, data: string) =>
    ipcRenderer.send('terminal-input', { id, data }),
  terminalResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal-resize', { id, cols, rows }),
  terminalDispose: (id: string) => ipcRenderer.invoke('terminal-dispose', id),
  terminalStop: (id: string) => ipcRenderer.invoke('terminal-stop', id),
  onTerminalData: (callback: (data: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('terminal-data', listener);
    return () => ipcRenderer.off('terminal-data', listener);
  },
  onTerminalExit: (callback: (data: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('terminal-exit', listener);
    return () => ipcRenderer.off('terminal-exit', listener);
  },
  getLocalControlCapability: async () => 'terminal-smoke-fixture',
});
