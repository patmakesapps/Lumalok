import { useState, useEffect, useCallback, useRef } from "react";

// ─── Detect if running inside Electron ───────────────────────────────────────
const isElectron = typeof window !== 'undefined' && !!window.vaultAPI;

// ─── Crypto Utilities ────────────────────────────────────────────────────────
const subtle = window.crypto.subtle;

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(data, password) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data)));
  const buf = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  buf.set(salt, 0);
  buf.set(iv, 16);
  buf.set(new Uint8Array(ciphertext), 28);
  return btoa(String.fromCharCode(...buf));
}

async function decryptData(b64, password) {
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const salt = buf.slice(0, 16);
  const iv = buf.slice(16, 28);
  const ciphertext = buf.slice(28);
  const key = await deriveKey(password, salt);
  const plain = await subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plain));
}

// ─── IndexedDB ───────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("vaultDB", 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore("vault", { keyPath: "id" });
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e);
  });
}
async function dbGet(db, id) {
  return new Promise((res, rej) => {
    const req = db.transaction("vault").objectStore("vault").get(id);
    req.onsuccess = e => res(e.target.result);
    req.onerror = rej;
  });
}
async function dbPut(db, obj) {
  return new Promise((res, rej) => {
    const tx = db.transaction("vault", "readwrite");
    tx.objectStore("vault").put(obj);
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const CATEGORIES = ["API Key", "Password", "Email", "Token", "Certificate", "SSH Key", "Database", "Other"];
const BRAND_NAME = "LUMALIEN";
const BRAND_TAGLINE = "OWN YOUR POTENTIAL.";
const LUMAKIT_REPO_URL = "https://github.com/patmakesapps/LumaKit";

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}
function expiryColor(days) {
  if (days === null) return null;
  if (days < 0) return "#ef4444";
  if (days <= 7) return "#f97316";
  if (days <= 30) return "#eab308";
  return "#22c55e";
}

// ─── Icons ───────────────────────────────────────────────────────────────────
const Icon = ({ d, size = 16, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const Icons = {
  lock: "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM7 11V7a5 5 0 0110 0v4",
  unlock: "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM7 11V7a5 5 0 019.9-1",
  plus: "M12 5v14M5 12h14",
  search: "M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 100 6 3 3 0 000-6z",
  eyeOff: "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  edit: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
  copy: "M8 4H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2M8 4a2 2 0 012-2h4a2 2 0 012 2M8 4h8",
  download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  upload: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12",
  folder: "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z",
  bell: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  x: "M18 6L6 18M6 6l12 12",
  info: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 8h.01M11 12h1v4h1",
  check: "M20 6L9 17l-5-5",
  tag: "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01",
  cloud: "M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z",
  key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
};

const SelectField = ({ value, onChange, options }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = options.find(o => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  return (
    <div className={`custom-select ${open ? "open" : ""}`} ref={ref}>
      <button
        type="button"
        className="form-input custom-select-trigger"
        onClick={() => setOpen(v => !v)}
      >
        <span>{selected?.label || ""}</span>
        <Icon d="M6 9l6 6 6-6" size={16} color="var(--accent2)" />
      </button>
      {open && (
        <div className="custom-select-menu">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              className={`custom-select-option ${o.value === selected?.value ? "active" : ""}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0f; --surface: #111118; --surface2: #1a1a24; --surface3: #22222f;
    --border: #2a2a3a; --accent: #7c6af7; --accent2: #a78bfa;
    --accent-glow: rgba(124,106,247,0.15); --text: #e8e8f0; --muted: #6b6b80;
    --danger: #ef4444; --warn: #f97316; --ok: #22c55e;
    --font: 'Syne', sans-serif; --mono: 'DM Mono', monospace;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--font); user-select: none; }
  .app { display: flex; height: 100vh; overflow: hidden; }
  .sidebar { width: 240px; min-width: 240px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
  .sidebar-logo { padding: 20px 20px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; -webkit-app-region: drag; }
  .logo-icon { width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, var(--accent), #5b4fcf); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 16px var(--accent-glow); }
  .logo-text { font-size: 18px; font-weight: 800; letter-spacing: -0.5px; }
  .logo-text span { color: var(--accent2); }
  .sidebar-section { padding: 16px 12px 8px; }
  .sidebar-label { font-size: 10px; font-weight: 700; letter-spacing: 1.5px; color: var(--muted); text-transform: uppercase; padding: 0 8px 8px; }
  .nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; color: var(--muted); transition: all 0.15s; border: none; background: none; width: 100%; text-align: left; }
  .nav-item:hover { background: var(--surface2); color: var(--text); }
  .nav-item.active { background: var(--accent-glow); color: var(--accent2); }
  .project-list { flex: 1; overflow-y: auto; padding: 8px 12px; }
  .project-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--muted); transition: all 0.15s; gap: 8px; }
  .project-item:hover { background: var(--surface2); color: var(--text); }
  .project-item.active { background: var(--accent-glow); color: var(--accent2); }
  .project-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .project-count { background: var(--surface3); color: var(--muted); font-size: 10px; padding: 2px 6px; border-radius: 10px; font-family: var(--mono); }
  .project-item-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
  .project-edit-btn { opacity: 0; color: var(--muted); cursor: pointer; padding: 2px; border-radius: 4px; display: flex; align-items: center; transition: opacity 0.15s; }
  .project-item:hover .project-edit-btn { opacity: 1; }
  .project-edit-btn:hover { color: var(--accent2); }
  .project-rename-input { background: var(--surface3); border: 1px solid var(--accent); border-radius: 4px; color: var(--text); font-size: 13px; font-weight: 600; padding: 1px 6px; width: 100%; outline: none; font-family: inherit; }
  .sidebar-footer { padding: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .topbar { padding: 16px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; background: var(--surface); -webkit-app-region: drag; }
  .topbar > * { -webkit-app-region: no-drag; }
  .topbar-title { font-size: 20px; font-weight: 800; flex: 1; }
  .search-wrap { position: relative; flex: 1; max-width: 360px; }
  .search-wrap svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); opacity: 0.4; }
  .search-input { width: 100%; background: var(--surface2); border: 1px solid var(--border); color: var(--text); padding: 8px 12px 8px 34px; border-radius: 8px; font-size: 13px; font-family: var(--font); outline: none; transition: border 0.15s; }
  .search-input:focus { border-color: var(--accent); }
  .search-input::placeholder { color: var(--muted); }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; font-family: var(--font); cursor: pointer; border: none; transition: all 0.15s; letter-spacing: 0.3px; }
  .btn-primary { background: linear-gradient(135deg, var(--accent), #5b4fcf); color: #fff; box-shadow: 0 0 20px var(--accent-glow); }
  .btn-primary:hover { box-shadow: 0 0 30px rgba(124,106,247,0.3); transform: translateY(-1px); }
  .btn-ghost { background: var(--surface2); color: var(--muted); border: 1px solid var(--border); }
  .btn-ghost:hover { color: var(--text); border-color: var(--accent); }
  .btn-danger { background: rgba(239,68,68,0.1); color: var(--danger); border: 1px solid rgba(239,68,68,0.2); }
  .btn-danger:hover { background: rgba(239,68,68,0.2); }
  .btn-sm { padding: 5px 10px; font-size: 12px; }
  .btn-icon { padding: 6px; border-radius: 6px; }
  .content { flex: 1; overflow-y: auto; padding: 24px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; position: relative; overflow: hidden; }
  .stat-card::before { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, var(--accent-glow), transparent); opacity: 0; transition: opacity 0.3s; }
  .stat-card:hover::before { opacity: 1; }
  .stat-value { font-size: 28px; font-weight: 800; font-family: var(--mono); }
  .stat-label { font-size: 12px; color: var(--muted); font-weight: 600; margin-top: 4px; }
  .expiry-list { display: flex; flex-direction: column; gap: 8px; }
  .expiry-item { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
  .expiry-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .expiry-name { font-weight: 600; font-size: 13px; flex: 1; }
  .expiry-project { font-size: 11px; color: var(--muted); }
  .expiry-days { font-family: var(--mono); font-size: 12px; font-weight: 500; }
  .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .section-title { font-size: 15px; font-weight: 700; }
  .entries-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
  .entry-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; transition: all 0.15s; cursor: pointer; position: relative; overflow: hidden; }
  .entry-card:hover { border-color: var(--accent); transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
  .entry-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  .entry-title { font-size: 14px; font-weight: 700; }
  .entry-category { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; padding: 3px 8px; border-radius: 6px; background: var(--accent-glow); color: var(--accent2); text-transform: uppercase; white-space: nowrap; }
  .entry-value { font-family: var(--mono); font-size: 12px; color: var(--muted); background: var(--surface2); padding: 6px 10px; border-radius: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 10px; }
  .entry-footer { display: flex; align-items: center; justify-content: space-between; }
  .entry-tags { display: flex; gap: 4px; flex-wrap: wrap; }
  .tag { font-size: 10px; color: var(--muted); border: 1px solid var(--border); padding: 2px 6px; border-radius: 4px; font-weight: 600; }
  .entry-expiry { font-size: 11px; font-family: var(--mono); font-weight: 500; }
  .entry-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
  .entry-card:hover .entry-actions { opacity: 1; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; backdrop-filter: blur(4px); animation: fadeIn 0.15s ease; }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 28px; width: 520px; max-width: 95vw; max-height: 85vh; overflow-y: auto; animation: slideUp 0.2s ease; box-shadow: 0 32px 64px rgba(0,0,0,0.5); }
  @keyframes slideUp { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } }
  .modal-title { font-size: 18px; font-weight: 800; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; }
  .form-group { margin-bottom: 16px; }
  .form-label { font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: 0.5px; margin-bottom: 6px; display: block; }
  .form-input, .form-select, .form-textarea { width: 100%; background: var(--surface2); border: 1px solid var(--border); color: var(--text); padding: 10px 12px; border-radius: 8px; font-size: 13px; font-family: var(--font); outline: none; transition: border 0.15s; }
  .form-input:focus, .form-select:focus, .form-textarea:focus { border-color: var(--accent); }
  .form-select { cursor: pointer; appearance: none; -webkit-appearance: none; padding-right: 44px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a78bfa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; background-size: 16px 16px; }
  .form-select option { background: var(--surface2); color: var(--text); }
  .form-select option:hover,
  .form-select option:focus,
  .form-select option:checked { background: rgba(124,106,247,0.35); color: var(--text); }
  .form-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
  .custom-select { position: relative; }
  .custom-select-trigger { display: flex; align-items: center; justify-content: space-between; cursor: pointer; text-align: left; }
  .custom-select-menu { position: absolute; left: 0; right: 0; top: calc(100% + 6px); background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; z-index: 220; box-shadow: 0 18px 40px rgba(0,0,0,0.45); }
  .custom-select-option { width: 100%; border: 0; background: transparent; color: var(--text); text-align: left; padding: 10px 12px; font-size: 13px; font-family: var(--font); cursor: pointer; }
  .custom-select-option:hover, .custom-select-option.active { background: rgba(124,106,247,0.35); color: #fff; }
  .custom-select.open .custom-select-trigger { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
  .form-textarea { resize: vertical; min-height: 80px; font-family: var(--mono); font-size: 12px; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .value-wrap { position: relative; }
  .value-wrap .form-input { font-family: var(--mono); padding-right: 36px; }
  .value-toggle { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; opacity: 0.5; }
  .value-toggle:hover { opacity: 1; }
  .modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  .lock-screen { min-height: 100vh; display: flex; flex-direction: column; gap: 14px; align-items: center; justify-content: center; background: var(--bg); background-image: radial-gradient(ellipse at 50% 0%, rgba(124,106,247,0.08) 0%, transparent 60%); }
  .lock-brand { text-align: center; padding: 0 14px; }
  .lock-brand-title { font-family: "Courier New", var(--mono), monospace; font-size: clamp(1.5rem, 6vw, 3.2rem); letter-spacing: 0.12em; color: var(--text); line-height: 1; }
  .lock-brand-sub { margin: 8px auto 0; max-width: 44ch; font-family: "Courier New", var(--mono), monospace; font-size: clamp(0.5rem, 0.78vw, 0.72rem); letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .lock-card { background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 40px; width: 400px; max-width: 95vw; box-shadow: 0 0 80px rgba(124,106,247,0.1); animation: slideUp 0.3s ease; }
  .lock-logo { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; justify-content: center; }
  .lock-logo-icon { width: 48px; height: 48px; border-radius: 14px; background: linear-gradient(135deg, var(--accent), #5b4fcf); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 30px var(--accent-glow); }
  .lock-title { font-size: 24px; font-weight: 800; text-align: center; }
  .lock-sub { font-size: 13px; color: var(--muted); text-align: center; margin-bottom: 24px; }
  .lock-error { color: var(--danger); font-size: 12px; text-align: center; margin-top: 8px; }
  .lock-reset-link { font-size: 11px; color: var(--muted); text-align: center; margin-top: 12px; cursor: pointer; }
  .lock-reset-link:hover { color: var(--danger); }
  .toast { position: fixed; bottom: 24px; right: 24px; background: var(--surface2); border: 1px solid var(--border); color: var(--text); padding: 12px 18px; border-radius: 10px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; animation: slideUp 0.2s ease; z-index: 999; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
  .toast.ok { border-color: rgba(34,197,94,0.4); }
  .toast.err { border-color: rgba(239,68,68,0.4); }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: var(--surface3); border-radius: 4px; }
  .empty-state { text-align: center; padding: 60px 20px; color: var(--muted); }
  .empty-state svg { opacity: 0.2; margin-bottom: 12px; }
  .empty-title { font-size: 16px; font-weight: 700; color: var(--text); opacity: 0.4; }
  .empty-sub { font-size: 13px; margin-top: 4px; }
  .filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .filter-chip { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border); background: var(--surface2); color: var(--muted); transition: all 0.15s; font-family: var(--font); }
  .filter-chip:hover, .filter-chip.active { border-color: var(--accent); color: var(--accent2); background: var(--accent-glow); }
  .backup-bar { background: rgba(124,106,247,0.08); border: 1px solid rgba(124,106,247,0.2); border-radius: 10px; padding: 10px 14px; font-size: 12px; display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .backup-path { font-family: var(--mono); color: var(--accent2); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .about-modal { max-width: 480px; }
  .about-badge { display: inline-block; background: var(--surface3); color: var(--accent2); font-size: 11px; font-family: var(--mono); padding: 3px 10px; border-radius: 20px; margin-bottom: 12px; }
  .about-content { font-size: 13px; color: var(--muted); line-height: 1.6; display: flex; flex-direction: column; gap: 16px; }
  .about-content p { color: var(--text); margin: 0; }
  .about-section { display: flex; flex-direction: column; gap: 8px; }
  .about-section-title { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
  .about-section ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 6px; }
  .about-section li strong { color: var(--text); }
  .about-warn { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: 8px; padding: 10px 14px; color: var(--warn); font-size: 12px; }
`;

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [masterPwd, setMasterPwd] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [pwdInput, setPwdInput] = useState("");
  const [confirmInput, setConfirmInput] = useState("");
  const [lockError, setLockError] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  const [db, setDb] = useState(null);
  const [projects, setProjects] = useState([]);
  const [entries, setEntries] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [view, setView] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState(null);

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [backupDir, setBackupDir] = useState(null);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [showAbout, setShowAbout] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [integrationConfig, setIntegrationConfig] = useState(null);
  const [revealedEntryIds, setRevealedEntryIds] = useState(() => new Set());

  // Entry form
  const [eTitle, setETitle] = useState("");
  const [eValue, setEValue] = useState("");
  const [eCategory, setECategory] = useState("Password");
  const [eTags, setETags] = useState("");
  const [eNote, setENote] = useState("");
  const [eExpiry, setEExpiry] = useState("");
  const [eProject, setEProject] = useState("");
  const [showEValue, setShowEValue] = useState(false);
  const [pName, setPName] = useState("");

  const showToast = (msg, type = "ok") => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

  useEffect(() => {
    openDB().then(d => {
      setDb(d);
      dbGet(d, "meta").then(m => setIsNew(!m));
    });
    // Load backup dir if in Electron
    if (isElectron) {
      window.vaultAPI.getBackupDir().then(dir => setBackupDir(dir));
      window.vaultAPI.getIntegrationConfig?.().then(config => setIntegrationConfig(config));
    }
  }, []);

  const persist = useCallback(async (p, e, pwd) => {
    if (!db) return;
    const usePwd = pwd || masterPwd;
    if (!usePwd) return;
    const enc = await encryptData({ projects: p, entries: e }, usePwd);
    await dbPut(db, { id: "vault", data: enc });
    await dbPut(db, { id: "meta", data: true });
    // Auto-backup to folder if configured (Electron only)
    if (isElectron && backupDir) {
      await window.vaultAPI.saveBackup(enc);
    }
    return enc;
  }, [db, masterPwd, backupDir]);

  const handleUnlock = async () => {
    setLockError("");
    if (!pwdInput) return setLockError("Enter your master password.");
    if (isNew) {
      if (pwdInput.length < 8) return setLockError("Password must be at least 8 characters.");
      if (pwdInput !== confirmInput) return setLockError("Passwords don't match.");
      try {
        const enc = await encryptData({ projects: [], entries: [] }, pwdInput);
        await dbPut(db, { id: "vault", data: enc });
        await dbPut(db, { id: "meta", data: true });
        setMasterPwd(pwdInput);
        setProjects([]); setEntries([]);
        setUnlocked(true);
      } catch {
        setLockError("Failed to create vault. Please try again.");
      }
    } else {
      try {
        const row = await dbGet(db, "vault");
        if (!row) { setMasterPwd(pwdInput); setProjects([]); setEntries([]); setUnlocked(true); return; }
        const d = await decryptData(row.data, pwdInput);
        setMasterPwd(pwdInput);
        setProjects(d.projects || []);
        setEntries(d.entries || []);
        setUnlocked(true);
      } catch {
        setLockError("Wrong password. Try again.");
      }
    }
  };

  const resetVault = async () => {
    const tx = db.transaction("vault", "readwrite");
    tx.objectStore("vault").clear();
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    setIsNew(true);
    setPwdInput(""); setConfirmInput(""); setLockError("");
  };

  const addProject = async () => {
    if (!pName.trim()) return;
    const p = { id: uid(), name: pName.trim(), created: now() };
    const np = [...projects, p];
    setProjects(np);
    await persist(np, entries);
    setPName(""); setShowProjectModal(false);
    setActiveProject(p.id); setView("project");
    showToast("Project created");
  };

  const renameProject = async (id, name) => {
    if (!name.trim()) return setEditingProjectId(null);
    const np = projects.map(p => p.id === id ? { ...p, name: name.trim() } : p);
    setProjects(np);
    setEditingProjectId(null);
    await persist(np, entries);
  };

  const deleteProject = async (pid) => {
    const np = projects.filter(p => p.id !== pid);
    const ne = entries.filter(e => e.projectId !== pid);
    setProjects(np); setEntries(ne);
    await persist(np, ne);
    if (activeProject === pid) { setActiveProject(null); setView("dashboard"); }
    showToast("Project deleted");
  };

  const openNewEntry = () => {
    setEditEntry(null); setETitle(""); setEValue(""); setECategory("Password");
    setETags(""); setENote(""); setEExpiry(""); setShowEValue(false);
    setEProject(activeProject || projects[0]?.id || "");
    setShowEntryModal(true);
  };

  const openEditEntry = (entry) => {
    setEditEntry(entry); setETitle(entry.title); setEValue(entry.value);
    setECategory(entry.category); setETags(entry.tags?.join(", ") || "");
    setENote(entry.note || ""); setEExpiry(entry.expiry || "");
    setEProject(entry.projectId); setShowEValue(false);
    setShowEntryModal(true);
  };

  const saveEntry = async () => {
    if (!eTitle.trim() || !eValue.trim()) return;
    const tags = eTags.split(",").map(t => t.trim()).filter(Boolean);
    let ne;
    if (editEntry) {
      ne = entries.map(e => e.id === editEntry.id ? { ...e, title: eTitle, value: eValue, category: eCategory, tags, note: eNote, expiry: eExpiry, projectId: eProject, updated: now() } : e);
    } else {
      ne = [...entries, { id: uid(), title: eTitle, value: eValue, category: eCategory, tags, note: eNote, expiry: eExpiry, projectId: eProject, created: now() }];
    }
    setEntries(ne);
    await persist(projects, ne);
    setShowEntryModal(false);
    showToast(editEntry ? "Entry updated" : "Entry saved");
  };

  const deleteEntry = async (id) => {
    const ne = entries.filter(e => e.id !== id);
    setEntries(ne);
    await persist(projects, ne);
    showToast("Entry deleted");
  };

  const copyValue = (val) => {
    navigator.clipboard.writeText(val);
    showToast("Copied to clipboard");
  };

  const toggleEntryReveal = (id) => {
    setRevealedEntryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportVault = async () => {
    const enc = await encryptData({ projects, entries }, masterPwd);
    if (isElectron) {
      const res = await window.vaultAPI.exportVault(enc);
      if (res.ok) showToast("Lumalok exported to " + res.filepath.split(/[\\/]/).pop());
      else if (res.reason) showToast("Export failed: " + res.reason, "err");
    } else {
      const blob = new Blob([enc], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `lumalok-backup-${new Date().toISOString().slice(0, 10)}.lumalok`;
      a.click(); URL.revokeObjectURL(url);
      showToast("Lumalok exported");
    }
  };

  const importVault = async (e) => {
    if (isElectron) {
      const res = await window.vaultAPI.importVault();
      if (!res.ok) return;
      try {
        const d = await decryptData(res.data, masterPwd);
        setProjects(d.projects || []); setEntries(d.entries || []);
        await persist(d.projects, d.entries);
        showToast("Lumalok imported");
      } catch { showToast("Import failed — wrong password or corrupt file", "err"); }
    } else {
      const file = e?.target?.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const d = await decryptData(text, masterPwd);
        setProjects(d.projects || []); setEntries(d.entries || []);
        await persist(d.projects, d.entries);
        showToast("Lumalok imported");
      } catch { showToast("Import failed — wrong password or corrupt file", "err"); }
      if (e?.target) e.target.value = "";
    }
  };

  const chooseBackupDir = async () => {
    if (!isElectron) return;
    const res = await window.vaultAPI.setBackupDir();
    if (res.ok) { setBackupDir(res.dir); showToast("Auto-backup folder set"); }
  };

  const openLumaKitRepo = async () => {
    if (isElectron && window.vaultAPI.openExternal) {
      const res = await window.vaultAPI.openExternal(LUMAKIT_REPO_URL);
      if (!res.ok) showToast(res.reason || "Could not open LumaKit", "err");
      return;
    }
    window.open(LUMAKIT_REPO_URL, "_blank", "noopener,noreferrer");
  };

  // ─── Derived ───────────────────────────────────────────────────────────────
  const setIntegrationEnabled = async (enabled) => {
    if (!isElectron) return;
    const config = await window.vaultAPI.setIntegrationEnabled(enabled);
    setIntegrationConfig(config);
    showToast(enabled ? "LumaKit integration enabled" : "LumaKit integration disabled");
  };

  const formatTags = (value) => {
    if (Array.isArray(value)) return value.map(t => String(t).trim()).filter(Boolean);
    if (typeof value === "string") return value.split(",").map(t => t.trim()).filter(Boolean);
    return [];
  };

  const publicEntry = useCallback((entry, includeValue = false) => {
    const project = projects.find(p => p.id === entry.projectId);
    return {
      id: entry.id,
      title: entry.title,
      category: entry.category,
      projectId: entry.projectId,
      projectName: project?.name || "",
      tags: entry.tags || [],
      note: entry.note || "",
      expiry: entry.expiry || "",
      daysUntilExpiry: daysUntil(entry.expiry),
      created: entry.created || "",
      updated: entry.updated || "",
      ...(includeValue ? { value: entry.value } : {}),
    };
  }, [projects]);

  const handleIntegrationRequest = useCallback(async ({ action, payload = {} }) => {
    if (!unlocked) return { statusCode: 423, body: { error: "Lumalok is locked. Unlock the vault first." } };

    if (action === "overview") {
      const expiringEntries = entries
        .map(e => publicEntry(e))
        .filter(e => e.daysUntilExpiry !== null && e.daysUntilExpiry <= 30)
        .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

      return {
        body: {
          projects: projects.length,
          secrets: entries.length,
          expiringSoon: expiringEntries.filter(e => e.daysUntilExpiry >= 0 && e.daysUntilExpiry <= 30).length,
          expired: expiringEntries.filter(e => e.daysUntilExpiry < 0).length,
          expiring: expiringEntries,
        },
      };
    }

    if (action === "listProjects") {
      return {
        body: {
          projects: projects.map(p => ({
            ...p,
            secretCount: entries.filter(e => e.projectId === p.id).length,
          })),
        },
      };
    }

    if (action === "createProject") {
      const name = String(payload.name || "").trim();
      if (!name) return { statusCode: 400, body: { error: "Project name is required." } };
      const existing = projects.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (existing) return { body: { project: existing, existing: true } };

      const project = { id: uid(), name, created: now() };
      const nextProjects = [...projects, project];
      setProjects(nextProjects);
      await persist(nextProjects, entries);
      return { statusCode: 201, body: { project } };
    }

    if (action === "listSecrets") {
      const q = String(payload.q || "").toLowerCase();
      const projectId = String(payload.projectId || "");
      const includeValues = payload.includeValues === true;
      const matches = entries.filter(e => {
        const matchProject = projectId ? e.projectId === projectId : true;
        const haystack = `${e.title} ${e.category} ${e.note || ""} ${(e.tags || []).join(" ")}`.toLowerCase();
        return matchProject && (!q || haystack.includes(q));
      });
      return { body: { secrets: matches.map(e => publicEntry(e, includeValues)) } };
    }

    if (action === "getSecret") {
      const entry = entries.find(e => e.id === payload.id);
      if (!entry) return { statusCode: 404, body: { error: "Secret not found." } };
      return { body: { secret: publicEntry(entry, payload.reveal === true) } };
    }

    if (action === "createSecret") {
      const title = String(payload.title || "").trim();
      const value = String(payload.value || "").trim();
      if (!title || !value) return { statusCode: 400, body: { error: "Secret title and value are required." } };

      let nextProjects = projects;
      let projectId = payload.projectId || "";
      const projectName = String(payload.projectName || "").trim();
      if (!projectId && projectName) {
        let project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());
        if (!project) {
          project = { id: uid(), name: projectName, created: now() };
          nextProjects = [...projects, project];
        }
        projectId = project.id;
      }
      if (!projectId) projectId = projects[0]?.id || "";
      if (!projectId) {
        const project = { id: uid(), name: "General", created: now() };
        nextProjects = [project];
        projectId = project.id;
      }

      const entry = {
        id: uid(),
        title,
        value,
        category: payload.category || "Password",
        tags: formatTags(payload.tags),
        note: payload.note || "",
        expiry: payload.expiry || "",
        projectId,
        created: now(),
      };
      const nextEntries = [...entries, entry];
      setProjects(nextProjects);
      setEntries(nextEntries);
      await persist(nextProjects, nextEntries);
      return { statusCode: 201, body: { secret: publicEntry(entry, false) } };
    }

    if (action === "updateSecret") {
      const existing = entries.find(e => e.id === payload.id);
      if (!existing) return { statusCode: 404, body: { error: "Secret not found." } };
      const nextEntries = entries.map(e => {
        if (e.id !== payload.id) return e;
        return {
          ...e,
          ...(payload.title !== undefined ? { title: String(payload.title).trim() } : {}),
          ...(payload.value !== undefined ? { value: String(payload.value) } : {}),
          ...(payload.category !== undefined ? { category: payload.category || "Password" } : {}),
          ...(payload.tags !== undefined ? { tags: formatTags(payload.tags) } : {}),
          ...(payload.note !== undefined ? { note: payload.note || "" } : {}),
          ...(payload.expiry !== undefined ? { expiry: payload.expiry || "" } : {}),
          ...(payload.projectId !== undefined ? { projectId: payload.projectId } : {}),
          updated: now(),
        };
      });
      setEntries(nextEntries);
      await persist(projects, nextEntries);
      return { body: { secret: publicEntry(nextEntries.find(e => e.id === payload.id), false) } };
    }

    return { statusCode: 404, body: { error: "Unknown Lumalok integration action." } };
  }, [unlocked, projects, entries, persist, publicEntry]);

  useEffect(() => {
    if (!isElectron || !window.vaultAPI.onIntegrationRequest) return;
    return window.vaultAPI.onIntegrationRequest(handleIntegrationRequest);
  }, [handleIntegrationRequest]);

  const filtered = entries.filter(e => {
    const inProject = view === "project" ? e.projectId === activeProject : true;
    const matchSearch = search ? (e.title + (e.note || "") + e.category + (e.tags?.join(" ") || "")).toLowerCase().includes(search.toLowerCase()) : true;
    const matchCat = catFilter ? e.category === catFilter : true;
    return inProject && matchSearch && matchCat;
  });

  const expiring = entries
    .map(e => ({ ...e, days: daysUntil(e.expiry) }))
    .filter(e => e.days !== null && e.days <= 30)
    .sort((a, b) => a.days - b.days);

  const projectForId = (id) => projects.find(p => p.id === id);

  // ─── Lock Screen ──────────────────────────────────────────────────────────
  if (!unlocked) return (
    <>
      <style>{css}</style>
      <div className="lock-screen">
        <div className="lock-brand">
          <div className="lock-brand-title">{BRAND_NAME}</div>
          <div className="lock-brand-sub">{BRAND_TAGLINE}</div>
        </div>
        <div className="lock-card">
          <div className="lock-logo">
            <div className="lock-logo-icon"><Icon d={Icons.shield} size={24} color="#fff" /></div>
          </div>
          <div className="lock-title">Lumalok</div>
          <p className="lock-sub" style={{ marginTop: 6 }}>{isNew ? "Create a master password to get started." : "Enter your master password to unlock."}</p>
          <div className="form-group" style={{ marginTop: 8 }}>
            <div className="value-wrap">
              <input className="form-input" type={showPwd ? "text" : "password"} placeholder="Master password" value={pwdInput} onChange={e => setPwdInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !isNew && handleUnlock()} style={{ fontFamily: "var(--mono)" }} autoFocus />
              <span className="value-toggle" onClick={() => setShowPwd(v => !v)}><Icon d={showPwd ? Icons.eyeOff : Icons.eye} /></span>
            </div>
          </div>
          {isNew && (
            <div className="form-group">
              <input className="form-input" type="password" placeholder="Confirm password" value={confirmInput} onChange={e => setConfirmInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleUnlock()} style={{ fontFamily: "var(--mono)" }} />
            </div>
          )}
          {lockError && <p className="lock-error">{lockError}</p>}
          <button className="btn btn-primary" style={{ width: "100%", marginTop: 8, justifyContent: "center" }} onClick={handleUnlock}>
            <Icon d={Icons.unlock} size={14} />{isNew ? "Create Vault" : "Unlock Vault"}
          </button>
          {!isNew && !showReset && (
            <p className="lock-reset-link" onClick={() => setShowReset(true)}>Forgot password?</p>
          )}
          {showReset && (
            <div style={{ marginTop: 12, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "12px 14px" }}>
              <p style={{ fontSize: 12, color: "var(--danger)", marginBottom: 8, lineHeight: 1.5 }}>
                <strong>Warning:</strong> This will permanently delete all vault data. There is no way to recover it.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: "center" }} onClick={() => setShowReset(false)}>Cancel</button>
                <button className="btn btn-danger btn-sm" style={{ flex: 1, justifyContent: "center" }} onClick={resetVault}>
                  <Icon d={Icons.trash} size={12} /> Reset Vault
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );

  // ─── Main UI ──────────────────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>
      <div className="app">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-icon"><Icon d={Icons.shield} size={16} color="#fff" /></div>
            <div className="logo-text">Lumalok<span>.</span></div>
          </div>
          <div className="sidebar-section">
            <div className="sidebar-label">Navigation</div>
            <button className={`nav-item ${view === "dashboard" ? "active" : ""}`} onClick={() => { setView("dashboard"); setActiveProject(null); setSearch(""); setCatFilter(null); }}>
              <Icon d={Icons.shield} size={14} /> Overview
            </button>
            <button className={`nav-item ${view === "search" ? "active" : ""}`} onClick={() => { setView("search"); setActiveProject(null); }}>
              <Icon d={Icons.search} size={14} /> Search All
            </button>
          </div>
          <div className="sidebar-section" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div className="sidebar-label">Projects</div>
            <div className="project-list">
              {projects.map(p => (
                <div key={p.id} className={`project-item ${activeProject === p.id && view === "project" ? "active" : ""}`}
                  onClick={() => { if (editingProjectId === p.id) return; setActiveProject(p.id); setView("project"); setSearch(""); setCatFilter(null); }}>
                  <Icon d={Icons.folder} size={13} />
                  {editingProjectId === p.id ? (
                    <input
                      className="project-rename-input"
                      value={editingProjectName}
                      onChange={e => setEditingProjectName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") renameProject(p.id, editingProjectName);
                        if (e.key === "Escape") setEditingProjectId(null);
                      }}
                      onBlur={() => renameProject(p.id, editingProjectName)}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="project-name">{p.name}</span>
                  )}
                  <div className="project-item-actions">
                    {editingProjectId !== p.id && (
                      <span className="project-edit-btn" onClick={e => { e.stopPropagation(); setEditingProjectId(p.id); setEditingProjectName(p.name); }}>
                        <Icon d={Icons.edit} size={11} />
                      </span>
                    )}
                    <span className="project-count">{entries.filter(e => e.projectId === p.id).length}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="sidebar-footer">
            <button className="btn btn-ghost btn-sm" style={{ justifyContent: "center" }} onClick={() => { setPName(""); setShowProjectModal(true); }}>
              <Icon d={Icons.plus} size={13} /> New Project
            </button>
            <button className="btn btn-ghost btn-sm" style={{ justifyContent: "center" }} onClick={exportVault}>
              <Icon d={Icons.download} size={13} /> Export Backup
            </button>
            {isElectron ? (
              <button className="btn btn-ghost btn-sm" style={{ justifyContent: "center" }} onClick={importVault}>
                <Icon d={Icons.upload} size={13} /> Import Backup
              </button>
            ) : (
              <label className="btn btn-ghost btn-sm" style={{ justifyContent: "center", cursor: "pointer" }}>
                <Icon d={Icons.upload} size={13} /> Import Backup
                <input type="file" accept=".lumalok,.vault" style={{ display: "none" }} onChange={importVault} />
              </label>
            )}
            {isElectron && (
              <button className="btn btn-ghost btn-sm" style={{ justifyContent: "center" }} onClick={() => setShowSettings(true)}>
                <Icon d={Icons.settings} size={13} /> Settings
              </button>
            )}
            <button className="btn btn-ghost btn-sm" style={{ justifyContent: "center" }} onClick={() => setShowAbout(true)}>
              <Icon d={Icons.info} size={13} /> About
            </button>
          </div>
        </div>

        {/* Main */}
        <div className="main">
          <div className="topbar">
            <div className="topbar-title">
              {view === "dashboard" && "Overview"}
              {view === "search" && "Search All Entries"}
              {view === "project" && (projectForId(activeProject)?.name || "Project")}
            </div>
            {(view === "search" || view === "project") && (
              <div className="search-wrap">
                <Icon d={Icons.search} size={14} />
                <input className="search-input" placeholder="Search entries…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            )}
            {view === "project" && <>
              <button className="btn btn-primary" onClick={openNewEntry}><Icon d={Icons.plus} size={14} /> Add Entry</button>
              <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete({ type: 'project', id: activeProject })}><Icon d={Icons.trash} size={13} /></button>
            </>}
          </div>

          <div className="content">
            {/* Dashboard */}
            {view === "dashboard" && (
              <>
                {isElectron && backupDir && (
                  <div className="backup-bar">
                    <Icon d={Icons.cloud} size={14} color="var(--accent2)" />
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>Auto-backup:</span>
                    <span className="backup-path">{backupDir}</span>
                  </div>
                )}
                <div className="stats-grid">
                  {[
                    { label: "Projects", value: projects.length },
                    { label: "Total Entries", value: entries.length },
                    { label: "Expiring Soon", value: expiring.filter(e => e.days >= 0 && e.days <= 30).length },
                    { label: "Expired", value: expiring.filter(e => e.days < 0).length },
                  ].map(s => (
                    <div key={s.label} className="stat-card">
                      <div className="stat-value">{s.value}</div>
                      <div className="stat-label">{s.label}</div>
                    </div>
                  ))}
                </div>
                {expiring.length > 0 && (
                  <>
                    <div className="section-header">
                      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Icon d={Icons.bell} size={15} color="var(--warn)" /> Expiry Alerts
                      </div>
                    </div>
                    <div className="expiry-list" style={{ marginBottom: 28 }}>
                      {expiring.map(e => (
                        <div key={e.id} className="expiry-item">
                          <div className="expiry-dot" style={{ background: expiryColor(e.days) }} />
                          <div style={{ flex: 1 }}>
                            <div className="expiry-name">{e.title}</div>
                            <div className="expiry-project">{projectForId(e.projectId)?.name} · {e.category}</div>
                          </div>
                          <div className="expiry-days" style={{ color: expiryColor(e.days) }}>
                            {e.days < 0 ? `${Math.abs(e.days)}d overdue` : e.days === 0 ? "expires today" : `${e.days}d left`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <div className="section-header">
                  <div className="section-title">All Projects</div>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setPName(""); setShowProjectModal(true); }}><Icon d={Icons.plus} size={13} /> New</button>
                </div>
                {projects.length === 0 ? (
                  <div className="empty-state">
                    <Icon d={Icons.folder} size={40} />
                    <div className="empty-title">No projects yet</div>
                    <div className="empty-sub">Create a project to start storing secrets</div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
                    {projects.map(p => {
                      const cnt = entries.filter(e => e.projectId === p.id).length;
                      const exp = entries.filter(e => e.projectId === p.id && daysUntil(e.expiry) !== null && daysUntil(e.expiry) <= 7).length;
                      return (
                        <div key={p.id} className="entry-card" onClick={() => { setActiveProject(p.id); setView("project"); }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                            <Icon d={Icons.folder} size={16} color="var(--accent2)" />
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>{cnt} entr{cnt === 1 ? "y" : "ies"}</div>
                          {exp > 0 && <div style={{ fontSize: 11, color: "var(--warn)", marginTop: 4 }}>⚠ {exp} expiring soon</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Project / Search */}
            {(view === "project" || view === "search") && (
              <>
                {view === "search" && (
                  <div className="search-wrap" style={{ maxWidth: "100%", marginBottom: 16 }}>
                    <Icon d={Icons.search} size={14} />
                    <input className="search-input" placeholder="Search all entries…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
                  </div>
                )}
                <div className="filter-bar">
                  <button className={`filter-chip ${!catFilter ? "active" : ""}`} onClick={() => setCatFilter(null)}>All</button>
                  {CATEGORIES.map(c => <button key={c} className={`filter-chip ${catFilter === c ? "active" : ""}`} onClick={() => setCatFilter(c === catFilter ? null : c)}>{c}</button>)}
                </div>
                {filtered.length === 0 ? (
                  <div className="empty-state">
                    <Icon d={Icons.key} size={40} />
                    <div className="empty-title">No entries found</div>
                    <div className="empty-sub">{view === "project" ? "Add your first entry" : "Try a different search"}</div>
                  </div>
                ) : (
                  <div className="entries-grid">
                    {filtered.map(e => {
                      const days = daysUntil(e.expiry);
                      return (
                        <div key={e.id} className="entry-card">
                          <div className="entry-card-top">
                            <div className="entry-title">{e.title}</div>
                            <div className="entry-category">{e.category}</div>
                          </div>
                          <div className="entry-value" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {revealedEntryIds.has(e.id) ? e.value : "•".repeat(Math.min(e.value.length, 24))}
                            </span>
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              title={revealedEntryIds.has(e.id) ? "Hide secret" : "Reveal secret"}
                              onClick={() => toggleEntryReveal(e.id)}
                            >
                              <Icon d={revealedEntryIds.has(e.id) ? Icons.eyeOff : Icons.eye} size={12} />
                            </button>
                          </div>
                          <div className="entry-footer">
                            <div className="entry-tags">{e.tags?.slice(0, 3).map(t => <span key={t} className="tag">{t}</span>)}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {days !== null && <div className="entry-expiry" style={{ color: expiryColor(days) }}>{days < 0 ? "expired" : `${days}d`}</div>}
                              <div className="entry-actions">
                                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => copyValue(e.value)}><Icon d={Icons.copy} size={12} /></button>
                                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openEditEntry(e)}><Icon d={Icons.edit} size={12} /></button>
                                <button className="btn btn-danger btn-icon btn-sm" onClick={() => setConfirmDelete({ type: 'entry', id: e.id })}><Icon d={Icons.trash} size={12} /></button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Project Modal */}
      {showProjectModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-title">New Project <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowProjectModal(false)}><Icon d={Icons.x} size={14} /></button></div>
            <div className="form-group">
              <label className="form-label">Project Name</label>
              <input className="form-input" placeholder="e.g. Stripe Integration" value={pName} onChange={e => setPName(e.target.value)} onKeyDown={e => e.key === "Enter" && addProject()} autoFocus />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowProjectModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addProject}><Icon d={Icons.plus} size={13} /> Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Entry Modal */}
      {showEntryModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-title">
              {editEntry ? "Edit Entry" : "New Entry"}
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowEntryModal(false)}><Icon d={Icons.x} size={14} /></button>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Title *</label>
                <input className="form-input" placeholder="e.g. Stripe API Key" value={eTitle} onChange={e => setETitle(e.target.value)} autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <SelectField
                  value={eCategory}
                  onChange={setECategory}
                  options={CATEGORIES.map(c => ({ value: c, label: c }))}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Value / Secret *</label>
              <div className="value-wrap">
                <input className="form-input" type={showEValue ? "text" : "password"} placeholder="Paste your secret here" value={eValue} onChange={e => setEValue(e.target.value)} />
                <span className="value-toggle" onClick={() => setShowEValue(v => !v)}><Icon d={showEValue ? Icons.eyeOff : Icons.eye} /></span>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Project</label>
                <SelectField
                  value={eProject}
                  onChange={setEProject}
                  options={projects.map(p => ({ value: p.id, label: p.name }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Expiry Date</label>
                <input className="form-input" type="date" value={eExpiry} onChange={e => setEExpiry(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Tags (comma-separated)</label>
              <input className="form-input" placeholder="e.g. production, backend, stripe" value={eTags} onChange={e => setETags(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" placeholder="Any additional context…" value={eNote} onChange={e => setENote(e.target.value)} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowEntryModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEntry}><Icon d={Icons.check} size={13} /> {editEntry ? "Update" : "Save Entry"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal (Electron only) */}
      {showSettings && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-title">Settings <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowSettings(false)}><Icon d={Icons.x} size={14} /></button></div>
            <div className="form-group">
              <label className="form-label">Auto-Backup Folder</label>
              <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                Every save will write a timestamped <code style={{ fontFamily: "var(--mono)", color: "var(--accent2)" }}>.lumalok</code> file here. Point this at your Dropbox, iCloud, or Google Drive folder for seamless cloud backup.
              </p>
              {backupDir && <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent2)", background: "var(--surface2)", padding: "8px 12px", borderRadius: 6, marginBottom: 10, wordBreak: "break-all" }}>{backupDir}</div>}
              <button className="btn btn-ghost" onClick={chooseBackupDir}><Icon d={Icons.folder} size={13} /> {backupDir ? "Change Folder" : "Choose Folder"}</button>
            </div>
            <div className="form-group">
              <label className="form-label">LumaKit Integration</label>
              <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                Allows LumaKit to manage this unlocked vault through a local-only authenticated API.
              </p>
              <button className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }} onClick={openLumaKitRepo}>
                <Icon d={Icons.download} size={13} /> Get LumaKit
              </button>
              {integrationConfig && (
                <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent2)", background: "var(--surface2)", padding: "8px 12px", borderRadius: 6, marginBottom: 10, wordBreak: "break-all" }}>
                  {integrationConfig.enabled ? `http://${integrationConfig.host}:${integrationConfig.port}` : "Disabled"}
                  <br />
                  {integrationConfig.configPath}
                </div>
              )}
              <button className={integrationConfig?.enabled ? "btn btn-danger" : "btn btn-ghost"} onClick={() => setIntegrationEnabled(!integrationConfig?.enabled)}>
                <Icon d={integrationConfig?.enabled ? Icons.x : Icons.check} size={13} /> {integrationConfig?.enabled ? "Disable Integration" : "Enable Integration"}
              </button>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setShowSettings(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {showAbout && (
        <div className="modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="modal about-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              About Lumalok
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowAbout(false)}><Icon d={Icons.x} size={14} /></button>
            </div>
            <div className="about-content">
              <div className="about-badge">v1.0.0</div>
              <p>Lumalok is a fully offline, encrypted secrets manager. Your data never leaves your device.</p>
              <div className="about-section">
                <div className="about-section-title">How your data is protected</div>
                <ul>
                  <li><strong>AES-256-GCM encryption</strong> — industry-standard symmetric encryption protects every entry</li>
                  <li><strong>PBKDF2 key derivation</strong> — your master password is run through 310,000 iterations before being used as a key, making brute-force attacks extremely slow</li>
                  <li><strong>Random salt & IV per save</strong> — each save generates fresh cryptographic randomness, so no two encrypted blobs look alike</li>
                  <li><strong>Local storage only</strong> — all data is stored in your app's local folder on this machine, never transmitted anywhere</li>
                </ul>
              </div>
              <div className="about-section">
                <div className="about-section-title">What we don't do</div>
                <ul>
                  <li>No accounts, no sign-in, no cloud sync</li>
                  <li>No telemetry or analytics</li>
                  <li>No internet connection required</li>
                </ul>
              </div>
              <div className="about-warn">If you forget your master password, your data cannot be recovered. Use the backup feature regularly.</div>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-title">
              {confirmDelete.type === 'project' ? 'Delete Project?' : 'Delete Entry?'}
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setConfirmDelete(null)}><Icon d={Icons.x} size={14} /></button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 8 }}>
              {confirmDelete.type === 'project'
                ? <>This will permanently delete the project <strong style={{ color: 'var(--text)' }}>{projectForId(confirmDelete.id)?.name}</strong> and <strong style={{ color: 'var(--danger)' }}>all {entries.filter(e => e.projectId === confirmDelete.id).length} entries</strong> inside it. This cannot be undone.</>
                : <>This will permanently delete <strong style={{ color: 'var(--text)' }}>{entries.find(e => e.id === confirmDelete.id)?.title}</strong>. This cannot be undone.</>
              }
            </p>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { confirmDelete.type === 'entry' ? deleteEntry(confirmDelete.id) : deleteProject(confirmDelete.id); setConfirmDelete(null); }}>
                <Icon d={Icons.trash} size={13} />
                {confirmDelete.type === 'project' ? 'Delete Project & Entries' : 'Delete Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.type}`}>
          <Icon d={toast.type === "ok" ? Icons.check : Icons.x} size={14} color={toast.type === "ok" ? "var(--ok)" : "var(--danger)"} />
          {toast.msg}
        </div>
      )}
    </>
  );
}
