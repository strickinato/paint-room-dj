const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.on('ready', () => {
  // Grant MIDI permission — Chromium requires explicit permission in Electron
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const allowed = ['midi', 'midiSysex'];
      callback(allowed.includes(permission));
    }
  );

  createWindow();
});

// --- IPC Handlers ---

ipcMain.handle('dialog:openFile', async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: options?.filters || []
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('fs:readFile', async (_event, filePath) => {
  if (typeof filePath !== 'string') throw new Error('Invalid file path');
  const buffer = await fs.readFile(filePath);
  return buffer;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
