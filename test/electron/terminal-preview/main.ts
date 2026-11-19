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

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import {
  disposeAllTerminals,
  registerTerminalIpcHandlers,
} from '../../../electron/main/terminal';
app.setPath('userData', process.env.EIGENT_SMOKE_PROFILE!);
app.whenReady().then(() => {
  registerTerminalIpcHandlers();
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      webviewTag: true,
      contextIsolation: true,
    },
  });
  win.loadURL(process.env.EIGENT_SMOKE_URL!);
});
app.on('before-quit', disposeAllTerminals);
app.on('window-all-closed', () => app.quit());
