const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const os = require('os');

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
const INTEGRATION_KEY = 'integration';
const INTEGRATION_HOST = '127.0.0.1';
const INTEGRATION_DEFAULT_PORT = 47322;
const INTEGRATION_DIR = path.join(os.homedir(), '.lumalok');
const INTEGRATION_FILE = path.join(INTEGRATION_DIR, 'integration.json');
let integrationServer;
let integrationPort = INTEGRATION_DEFAULT_PORT;
const pendingIntegrationRequests = new Map();

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

function getConfig() {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function setConfig(config) {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function getIntegrationConfig() {
  const config = getConfig();
  const integration = config[INTEGRATION_KEY] || {};
  return {
    enabled: integration.enabled === true,
    host: INTEGRATION_HOST,
    port: Number(integration.port) || INTEGRATION_DEFAULT_PORT,
    token: integration.token || '',
  };
}

function saveIntegrationConfig(integration) {
  const config = getConfig();
  config[INTEGRATION_KEY] = {
    enabled: integration.enabled === true,
    port: Number(integration.port) || INTEGRATION_DEFAULT_PORT,
    token: integration.token || crypto.randomBytes(24).toString('hex'),
  };
  setConfig(config);
  writeIntegrationFile(config[INTEGRATION_KEY]);
  return getIntegrationConfig();
}

function writeIntegrationFile(integration) {
  try {
    fs.mkdirSync(INTEGRATION_DIR, { recursive: true });
    fs.writeFileSync(INTEGRATION_FILE, JSON.stringify({
      enabled: integration.enabled === true,
      host: INTEGRATION_HOST,
      port: Number(integration.port) || INTEGRATION_DEFAULT_PORT,
      token: integration.token || '',
    }, null, 2));
  } catch (err) {
    console.warn('Failed to write Lumalok integration file:', err.message);
  }
}

function publicIntegrationConfig() {
  const integration = getIntegrationConfig();
  return {
    enabled: integration.enabled,
    host: integration.host,
    port: integration.port,
    configPath: INTEGRATION_FILE,
    hasToken: Boolean(integration.token),
    tokenPreview: integration.token ? `${integration.token.slice(0, 6)}...${integration.token.slice(-4)}` : '',
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendIntegrationRequest(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      reject(new Error('Lumalok window is not available'));
      return;
    }

    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pendingIntegrationRequests.delete(id);
      reject(new Error('Lumalok did not respond. Unlock the vault and try again.'));
    }, 10000);

    pendingIntegrationRequests.set(id, { resolve, reject, timeout });
    mainWindow.webContents.send('integration:request', { id, action, payload });
  });
}

function isAuthorized(req, token) {
  const header = req.headers.authorization || '';
  return Boolean(token) && header === `Bearer ${token}`;
}

async function routeIntegrationRequest(req, res) {
  const integration = getIntegrationConfig();
  if (!integration.enabled) {
    sendJson(res, 503, { error: 'Lumalok integration is disabled.' });
    return;
  }

  if (req.url === '/v1/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, app: 'lumalok', enabled: true });
    return;
  }

  if (!isAuthorized(req, integration.token)) {
    sendJson(res, 401, { error: 'Unauthorized.' });
    return;
  }

  const url = new URL(req.url, `http://${INTEGRATION_HOST}:${integration.port}`);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'v1') {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }

  try {
    let body = {};
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      body = await readJsonBody(req);
    }

    let result;
    if (segments[1] === 'overview' && req.method === 'GET') {
      result = await sendIntegrationRequest('overview');
    } else if (segments[1] === 'projects' && req.method === 'GET') {
      result = await sendIntegrationRequest('listProjects');
    } else if (segments[1] === 'projects' && req.method === 'POST') {
      result = await sendIntegrationRequest('createProject', body);
    } else if (segments[1] === 'secrets' && req.method === 'GET' && !segments[2]) {
      result = await sendIntegrationRequest('listSecrets', {
        projectId: url.searchParams.get('projectId') || '',
        q: url.searchParams.get('q') || '',
        includeValues: url.searchParams.get('includeValues') === 'true',
      });
    } else if (segments[1] === 'secrets' && req.method === 'POST') {
      result = await sendIntegrationRequest('createSecret', body);
    } else if (segments[1] === 'secrets' && segments[2] && req.method === 'GET') {
      result = await sendIntegrationRequest('getSecret', {
        id: segments[2],
        reveal: url.searchParams.get('reveal') === 'true',
      });
    } else if (segments[1] === 'secrets' && segments[2] && req.method === 'PATCH') {
      result = await sendIntegrationRequest('updateSecret', { id: segments[2], ...body });
    } else {
      sendJson(res, 404, { error: 'Not found.' });
      return;
    }

    sendJson(res, result?.statusCode || 200, result?.body ?? result);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Lumalok integration failed.' });
  }
}

function startIntegrationServer() {
  const integration = getIntegrationConfig();
  writeIntegrationFile(integration);
  if (!integration.enabled || integrationServer) return;

  integrationServer = http.createServer(routeIntegrationRequest);
  integrationServer.on('error', err => {
    console.warn('Lumalok integration server failed:', err.message);
  });
  integrationServer.listen(integration.port, INTEGRATION_HOST, () => {
    integrationPort = integrationServer.address().port;
    const latest = getIntegrationConfig();
    if (integrationPort !== latest.port) {
      saveIntegrationConfig({ ...latest, port: integrationPort });
    }
  });
}

function stopIntegrationServer() {
  if (!integrationServer) return;
  integrationServer.close();
  integrationServer = null;
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
    mainWindow.loadURL('http://127.0.0.1:5173').catch(() => {
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
  tray.setToolTip('Lumalok — Secrets Manager');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Lumalok', click: () => { mainWindow.show(); mainWindow.focus(); } },
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
    const filename = `lumalok-backup-${new Date().toISOString().slice(0, 10)}.lumalok`;
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
    title: 'Export Lumalok Backup',
    defaultPath: `lumalok-backup-${new Date().toISOString().slice(0, 10)}.lumalok`,
    filters: [
      { name: 'Lumalok File', extensions: ['lumalok'] },
      { name: 'Legacy Vault File', extensions: ['vault'] }
    ]
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
    title: 'Import Lumalok Backup',
    filters: [
      { name: 'Lumalok File', extensions: ['lumalok'] },
      { name: 'Legacy Vault File', extensions: ['vault'] }
    ],
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

ipcMain.handle('integration:get-config', () => {
  return publicIntegrationConfig();
});

ipcMain.handle('app:open-external', async (_, url) => {
  if (typeof url !== 'string' || !/^https:\/\/github\.com\/patmakesapps\/LumaKit\/?$/.test(url)) {
    return { ok: false, reason: 'URL is not allowed.' };
  }
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('integration:set-enabled', (_, enabled) => {
  const current = getIntegrationConfig();
  const token = current.token || crypto.randomBytes(24).toString('hex');
  const next = saveIntegrationConfig({ ...current, enabled: enabled === true, token });
  if (next.enabled) startIntegrationServer();
  else stopIntegrationServer();
  return publicIntegrationConfig();
});

ipcMain.on('integration:response', (_, message) => {
  const pending = pendingIntegrationRequests.get(message?.id);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingIntegrationRequests.delete(message.id);
  if (message.error) pending.reject(new Error(message.error));
  else pending.resolve(message.result);
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
    startIntegrationServer();

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
