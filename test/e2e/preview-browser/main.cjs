const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', process.env.PREVIEW_TEST_PROFILE);
const root = require('node:fs').realpathSync(process.env.PREVIEW_TEST_ASSETS);
async function readFile(filePath) {
  const resolved = await fs.realpath(filePath);
  if (!resolved.startsWith(root + path.sep)) throw new Error('Outside fixture');
  return fs.readFile(resolved);
}
app.whenReady().then(async () => {
  ipcMain.handle('preview-test-file', async (_event, channel, args) => {
    if (channel === 'open-file') return (await readFile(args[1])).toString();
    if (channel === 'get-file-preview-metadata')
      return { size: (await readFile(args[0])).length };
    if (channel === 'read-image')
      return (
        'data:image/svg+xml;base64,' +
        (await readFile(args[0])).toString('base64')
      );
    throw new Error('Unexpected fixture IPC: ' + channel);
  });
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadURL(process.env.PREVIEW_TEST_URL);
});
app.on('window-all-closed', () => app.quit());
