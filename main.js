const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;
let mainWindow;
let tray;
const APP_ID = 'com.lumalien.vault';

function resolveAssetPath(...segments) {
  const devPath = path.join(__dirname, ...segments);
  const packagedPath = path.join(process.resourcesPath, ...segments);
  if (fs.existsSync(devPath)) return devPath;
  if (fs.existsSync(packagedPath)) return packagedPath;
  return devPath;
}

// ─── Auto-backup config ───────────────────────────────────────────────────────
// Change this to your Dropbox / iCloud / Google Drive folder path
// e.g. on Mac:  /Users/yourname/Dropbox/vault-backups
// e.g. on Win:  C:\Users\yourname\Dropbox\vault-backups
const BACKUP_DIR_KEY = 'backupDir';

function getBackupDir() {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config[BACKUP_DIR_KEY] || null;
  } catch {
    return null;
  }
}

function setBackupDir(dir) {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  config[BACKUP_DIR_KEY] = dir;
  fs.writeFileSync(configPath, JSON.stringify(config));
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  const distIndexPath = path.join(__dirname, 'dist/index.html');
  const windowIconPath = resolveAssetPath('src', 'assets', 'icon.ico');
  const windowIcon = nativeImage.createFromPath(windowIconPath);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // Security: renderer can't access Node directly
      nodeIntegration: false,   // Security: no Node in renderer
      sandbox: false
    },
    icon: windowIcon,
    show: false,
  });

  // Load app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      if (fs.existsSync(distIndexPath)) {
        mainWindow.loadFile(distIndexPath);
      }
    });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(distIndexPath);
  }

  // Dev fallback when Vite server is not running.
  mainWindow.webContents.on('did-fail-load', () => {
    if (isDev && fs.existsSync(distIndexPath)) {
      mainWindow.loadFile(distIndexPath);
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Quit on close (security: don't keep decrypted data in memory)
  mainWindow.on('close', () => {
    app.isQuiting = true;
    app.quit();
  });
}

// ─── System Tray ─────────────────────────────────────────────────────────────
function createTray() {
  // Use a simple fallback if icon not found
  let trayIcon;
  const iconPath = resolveAssetPath('src', 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Vault — Secrets Manager');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Vault', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

// ─── IPC Handlers (renderer → main communication) ────────────────────────────

// Save encrypted vault to disk (auto-backup location)
ipcMain.handle('vault:save-backup', async (_, encryptedData) => {
  const backupDir = getBackupDir();
  if (!backupDir) return { ok: false, reason: 'No backup folder set' };

  try {
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const filename = `vault-backup-${new Date().toISOString().slice(0, 10)}.vault`;
    const filepath = path.join(backupDir, filename);
    fs.writeFileSync(filepath, encryptedData, 'utf8');
    return { ok: true, filepath };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

// Export vault — open save dialog
ipcMain.handle('vault:export', async (_, encryptedData) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Vault Backup',
    defaultPath: `vault-backup-${new Date().toISOString().slice(0, 10)}.vault`,
    filters: [{ name: 'Vault File', extensions: ['vault'] }]
  });
  if (canceled || !filePath) return { ok: false };
  try {
    fs.writeFileSync(filePath, encryptedData, 'utf8');
    return { ok: true, filepath: filePath };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

// Import vault — open file dialog
ipcMain.handle('vault:import', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Vault Backup',
    filters: [{ name: 'Vault File', extensions: ['vault'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths[0]) return { ok: false };
  try {
    const data = fs.readFileSync(filePaths[0], 'utf8');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

// Set backup folder
ipcMain.handle('vault:set-backup-dir', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Auto-Backup Folder',
    properties: ['openDirectory']
  });
  if (canceled || !filePaths[0]) return { ok: false };
  setBackupDir(filePaths[0]);
  return { ok: true, dir: filePaths[0] };
});

// Get current backup dir
ipcMain.handle('vault:get-backup-dir', () => {
  return getBackupDir();
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

// Enforce single instance — if a second instance launches, focus the existing window
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else mainWindow.show();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuiting = true;
});
