// Test-only Electron main: the production stream relay and preload, wired to
// a stand-in Brain on 127.0.0.1. The window stays hidden.
const { app, BrowserWindow, ipcMain } = require('electron');
const { isBrainStreamRelayDisabled, registerBrainStreamRelay } = require(
  process.env.STREAM_RELAY_MODULE
);

app.setPath('userData', process.env.STREAM_RELAY_PROFILE);
let win = null;
app.whenReady().then(async () => {
  registerBrainStreamRelay({
    ipcMain,
    enabled: !isBrainStreamRelayDisabled(),
    getManagedBackendPort: () => Number(process.env.STREAM_RELAY_BRAIN_PORT),
    isTrustedSender: (event) =>
      Boolean(
        win &&
        !win.isDestroyed() &&
        event.sender.id === win.webContents.id &&
        event.senderFrame === event.sender.mainFrame
      ),
    log: { warn: (message) => console.warn(message) },
  });
  win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      preload: process.env.STREAM_RELAY_PRELOAD,
      // Same as the application window.
      nodeIntegration: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  await win.loadURL(process.env.STREAM_RELAY_TEST_URL);
});
app.on('window-all-closed', () => app.quit());
