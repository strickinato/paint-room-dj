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

const PREFS_FILE = path.join(app.getPath('userData'), 'prefs.json');

// --- IPC Handlers ---

// Project directory prefs
ipcMain.handle('prefs:getProjectDir', async () => {
  try {
    const data = await fs.readFile(PREFS_FILE, 'utf-8');
    const prefs = JSON.parse(data);
    if (prefs.projectDir) {
      await fs.access(prefs.projectDir);
      return prefs.projectDir;
    }
    return null;
  } catch {
    return null;
  }
});

ipcMain.handle('prefs:setProjectDir', async (_event, dir) => {
  let prefs = {};
  try {
    const data = await fs.readFile(PREFS_FILE, 'utf-8');
    prefs = JSON.parse(data);
  } catch { /* fresh prefs */ }
  prefs.projectDir = dir;
  await fs.writeFile(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf-8');
});

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// State load/save from project directory
ipcMain.handle('state:load', async (_event, projectDir) => {
  try {
    const filePath = path.join(projectDir, 'data.json');
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
});

ipcMain.handle('state:save', async (_event, projectDir, state) => {
  const filePath = path.join(projectDir, 'data.json');
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
});

// Path utilities
ipcMain.handle('path:resolve', (_event, projectDir, relativePath) => {
  return path.resolve(projectDir, relativePath);
});

ipcMain.handle('path:relative', (_event, projectDir, absolutePath) => {
  return path.relative(projectDir, absolutePath);
});

// Copy file into project directory
ipcMain.handle('fs:copyIntoProject', async (_event, projectDir, sourceAbsPath) => {
  const filename = path.basename(sourceAbsPath);
  const dest = path.join(projectDir, filename);
  // avoid overwriting by appending a number if needed
  let finalDest = dest;
  let counter = 1;
  while (true) {
    try {
      await fs.access(finalDest);
      // file exists, try next name
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      finalDest = path.join(projectDir, `${base}_${counter}${ext}`);
      counter++;
    } catch {
      // doesn't exist, good to use
      break;
    }
  }
  await fs.copyFile(sourceAbsPath, finalDest);
  return path.relative(projectDir, finalDest);
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
