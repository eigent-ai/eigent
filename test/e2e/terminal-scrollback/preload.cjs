const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('terminalFixtureApi', {
  terminalCreate: (options) => ipcRenderer.invoke('terminal-create', options),
  terminalInput: (id, data) => ipcRenderer.send('terminal-input', id, data),
  terminalResize: (id, cols, rows) =>
    ipcRenderer.send('terminal-resize', id, cols, rows),
  terminalDispose: (id) => ipcRenderer.invoke('terminal-dispose', id),
  onTerminalData: (callback) => subscribe('terminal-data', callback),
  onTerminalExit: (callback) => subscribe('terminal-exit', callback),
});
