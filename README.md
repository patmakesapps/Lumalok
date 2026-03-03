# Lumalok — Personal Secrets Manager

Your encrypted, local-first secrets vault. AES-256-GCM encrypted. Electron desktop app.

---

## Quick Start (5 minutes)

### Prerequisites
- [Node.js](https://nodejs.org) v18 or higher (just download and install)

### Run in dev mode
```bash
# 1. Unzip / navigate to this folder
cd lumalok

# 2. Install dependencies (one time)
npm install

# 3. Launch the desktop app
npm run dev
```

That's it. A desktop window will open.

---

## Build a distributable installer

```bash
npm run build
```

This outputs to the `dist-electron/` folder:
- **Windows**: `Lumalok Setup 1.0.0.exe`
- **macOS**: `Lumalok-1.0.0.dmg`
- **Linux**: `Lumalok-1.0.0.AppImage`

---

## App Icon (optional)

To use a custom icon, replace these files in `src/assets/`:
- `icon.png` — 512×512 PNG (used for Linux + dev)
- `icon.ico` — Windows icon (you can convert from PNG at https://icoconvert.com)
- `icon.icns` — macOS icon (use `iconutil` on Mac or an online converter)

---

## Auto-Backup Setup

1. Open the app and unlock your vault
2. Click **Settings** in the sidebar
3. Choose a folder — point it at your **Dropbox**, **iCloud Drive**, or **Google Drive** folder
4. Every time you save an entry, a timestamped `.lumalok` backup is written there automatically

The backup file is fully encrypted. Even if someone gets the file, they can't read it without your master password.

---

## Security Details

| Feature | Implementation |
|---|---|
| Encryption | AES-256-GCM |
| Key derivation | PBKDF2, SHA-256, 310,000 iterations |
| Master password | Never stored — only used in memory to derive key |
| Local storage | IndexedDB (encrypted blob) |
| Backup format | Base64-encoded encrypted binary |
| Node access | Sandboxed via contextBridge — renderer has no direct Node access |

---

## File Structure

```
vault-app/
├── main.js          ← Electron main process (window, file I/O, dialogs, tray)
├── preload.js       ← Secure bridge (exposes only safe APIs to React)
├── src/
│   ├── main.jsx     ← React entry point
│   └── App.jsx      ← Full vault UI + crypto logic
├── index.html       ← HTML shell
├── vite.config.js   ← Vite bundler config
└── package.json     ← Dependencies + build config
```
