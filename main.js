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
      const allowed = ['midi', 'midiSysex', 'media', 'audioCapture', 'speaker-selection'];
      callback(allowed.includes(permission));
    }
  );

  createWindow();
});

const STATE_FILE = path.join(app.getPath('userData'), 'slot-state.json');

// --- IPC Handlers ---

ipcMain.handle('state:load', async () => {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
});

ipcMain.handle('state:save', async (_event, state) => {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
});

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

ipcMain.handle('fs:fileExists', async (_event, filePath) => {
  if (typeof filePath !== 'string') return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
