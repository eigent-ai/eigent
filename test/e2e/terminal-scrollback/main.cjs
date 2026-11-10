const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const pty = require('node-pty');
const shells = new Map();
app.setPath('userData', process.env.TERMINAL_TEST_PROFILE);
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  ipcMain.handle('terminal-create', (_event, options) => {
    if (shells.has(options.id)) return { success: true, existing: true };
    const shell = pty.spawn('/bin/zsh', ['-f'], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: process.env.TERMINAL_TEST_PROFILE,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.TERMINAL_TEST_PROFILE,
        ZDOTDIR: process.env.TERMINAL_TEST_PROFILE,
        TERM: 'xterm-256color',
        PS1: 'space_0123456789abcdef0123456789abcdef git:(main) fixture> ',
        RPS1: '',
      },
    });
    shells.set(options.id, shell);
    shell.onData((data) => {
      if (!win.isDestroyed())
        win.webContents.send('terminal-data', { id: options.id, data });
    });
    shell.onExit(({ exitCode }) => {
      if (!win.isDestroyed())
        win.webContents.send('terminal-exit', { id: options.id, exitCode });
    });
    return { success: true };
  });
  ipcMain.on('terminal-input', (_event, id, data) =>
    shells.get(id)?.write(data)
  );
  ipcMain.on('terminal-resize', (_event, id, cols, rows) =>
    shells.get(id)?.resize(cols, rows)
  );
  ipcMain.handle('terminal-dispose', (_event, id) => {
    shells.get(id)?.kill();
    shells.delete(id);
    return { success: true };
  });
  await win.loadURL(process.env.TERMINAL_TEST_URL);
});
app.on('before-quit', () => {
  for (const shell of shells.values()) shell.kill();
});
app.on('window-all-closed', () => app.quit());
