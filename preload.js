const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
});
