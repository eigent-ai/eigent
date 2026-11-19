const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ipcRenderer', {
  invoke: (channel, ...args) =>
    ipcRenderer.invoke('preview-test-file', channel, args),
});
contextBridge.exposeInMainWorld('electronAPI', {
  readFileAsDataUrl: (path) =>
    ipcRenderer.invoke('preview-test-file', 'read-image', [path]),
});
