const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  send: (channel, payload) => ipcRenderer.send(channel, payload),
  on: (channel, handler) => {
    const valid = new Set(['status', 'connect', 'disconnect', 'reset', 'update-terms']);
    if (!valid.has(channel)) return;
    const listener = (_evt, data) => handler(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
