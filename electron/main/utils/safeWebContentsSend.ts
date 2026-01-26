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

import log from 'electron-log'
import { getMainWindow } from "../init";

/**
 * Safely send message to main window if it exists and is not destroyed
 * @param channel - The IPC channel to send message to
 * @param data - The data to send
 */
function safeMainWindowSend(channel: string, data?: any) {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
    return true;
  } else {
    log.warn(`[WEBCONTENTS SEND] Cannot send message to main window: ${channel}`, data);
    return false;
  }
}

export {safeMainWindowSend}