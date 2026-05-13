/**
 * preload.js — Security bridge
 *
 * This file runs in a privileged context and exposes a limited,
 * safe API to the renderer (React). The renderer can ONLY call
 * these specific functions — it has no direct access to Node.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultAPI', {
  // Export vault to a file (opens save dialog)
  exportVault: (encryptedData) =>
    ipcRenderer.invoke('vault:export', encryptedData),

  // Import vault from a file (opens open dialog)
  importVault: () =>
    ipcRenderer.invoke('vault:import'),

  // Save a timestamped backup to the auto-backup folder
  saveBackup: (encryptedData) =>
    ipcRenderer.invoke('vault:save-backup', encryptedData),

  // Let the user choose an auto-backup folder
  setBackupDir: () =>
    ipcRenderer.invoke('vault:set-backup-dir'),

  // Get the currently configured backup folder path
  getBackupDir: () =>
    ipcRenderer.invoke('vault:get-backup-dir'),

  // Open a safe external URL in the user's browser
  openExternal: (url) =>
    ipcRenderer.invoke('app:open-external', url),

  // Get local integration status for Lumi/LumaKit
  getIntegrationConfig: () =>
    ipcRenderer.invoke('integration:get-config'),

  // Enable or disable the local integration API
  setIntegrationEnabled: (enabled) =>
    ipcRenderer.invoke('integration:set-enabled', enabled),

  // Handle authenticated local API requests from the Electron main process
  onIntegrationRequest: (handler) => {
    const listener = async (_event, message) => {
      try {
        const result = await handler(message);
        ipcRenderer.send('integration:response', { id: message.id, result });
      } catch (err) {
        ipcRenderer.send('integration:response', {
          id: message.id,
          error: err?.message || 'Integration request failed',
        });
      }
    };
    ipcRenderer.on('integration:request', listener);
    return () => ipcRenderer.removeListener('integration:request', listener);
  },
});
