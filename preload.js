const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('fs:fileExists', filePath),
  copyIntoProject: (projectDir, sourcePath) => ipcRenderer.invoke('fs:copyIntoProject', projectDir, sourcePath),
  getFilePath: (file) => webUtils.getPathForFile(file),
  getProjectDir: () => ipcRenderer.invoke('prefs:getProjectDir'),
  setProjectDir: (dir) => ipcRenderer.invoke('prefs:setProjectDir', dir),
  resolvePath: (projectDir, relPath) => ipcRenderer.invoke('path:resolve', projectDir, relPath),
  relativePath: (projectDir, absPath) => ipcRenderer.invoke('path:relative', projectDir, absPath),
  loadState: (projectDir) => ipcRenderer.invoke('state:load', projectDir),
  saveState: (projectDir, state) => ipcRenderer.invoke('state:save', projectDir, state),
});
