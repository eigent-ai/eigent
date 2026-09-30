const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.BUNDLE_PROBE_PROFILE);
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadURL(process.env.BUNDLE_PROBE_URL);
});
app.on('window-all-closed', () => app.quit());
