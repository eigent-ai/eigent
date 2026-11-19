const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('recorder', {
  chunk: (message) => ipcRenderer.invoke('recording-worker-chunk', message),
  report: (message) => ipcRenderer.invoke('recording-worker-report', message),
  onCommand: (callback) =>
    ipcRenderer.on('recording-worker-command', (_event, command) =>
      callback(command)
    ),
});
contextBridge.exposeInMainWorld('compositor', {
  onLayout: (callback) => {
    ipcRenderer.on('recording-worker-layout', (_event, layout) =>
      callback(layout)
    );
  },
  onFrame: (callback) => {
    ipcRenderer.on('recording-worker-frame', (_event, frame) =>
      callback(frame)
    );
  },
  acknowledge: (id) => {
    ipcRenderer.send('recording-worker-frame-ack', id);
  },
  onSourceEnded: (callback) => {
    ipcRenderer.on('recording-worker-source-ended', () => callback());
  },
});
