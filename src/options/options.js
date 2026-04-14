/**
 * Options page logic.
 * Loads settings from service worker, saves changes, manages data export/import.
 */

import { MSG } from '../shared/constants.js';

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

// ── Notification permission UI ────────────────────────────────────────────

async function updateNotifStatus() {
  const statusEl = document.getElementById('notif-status');
  const reqBtn = document.getElementById('btn-request-notif');

  const perm = Notification.permission;
  if (perm === 'granted') {
    statusEl.className = 'notif-status granted';
    statusEl.textContent = 'Notifications are enabled.';
    reqBtn.style.display = 'none';
  } else if (perm === 'denied') {
    statusEl.className = 'notif-status denied';
    statusEl.textContent = 'Notifications are blocked. Enable them in browser settings.';
    reqBtn.style.display = 'none';
  } else {
    statusEl.className = 'notif-status default';
    statusEl.textContent = 'Notifications not yet granted.';
    reqBtn.style.display = 'inline-flex';
  }
}

document.getElementById('btn-request-notif').addEventListener('click', async () => {
  await Notification.requestPermission();
  updateNotifStatus();
});

// ── Load settings ─────────────────────────────────────────────────────────

async function loadSettings() {
  const { settings } = await send({ type: MSG.GET_SETTINGS });
  if (!settings) return;

  document.getElementById('notif-enabled').checked = settings.notificationsEnabled ?? true;
  document.getElementById('notif-stock').checked = settings.stockNotificationsEnabled ?? true;
  setSelectValue('default-interval', String(settings.defaultInterval ?? 15));
  setSelectValue('default-currency', settings.defaultCurrency ?? 'USD');
  document.getElementById('history-max').value = String(settings.historyMaxPoints ?? 500);
}

function setSelectValue(id, value) {
  const sel = document.getElementById(id);
  const opt = Array.from(sel.options).find((o) => o.value === value);
  if (opt) sel.value = value;
}

// ── Save settings ─────────────────────────────────────────────────────────

document.getElementById('btn-save').addEventListener('click', async () => {
  const data = {
    notificationsEnabled: document.getElementById('notif-enabled').checked,
    stockNotificationsEnabled: document.getElementById('notif-stock').checked,
    defaultInterval: Number(document.getElementById('default-interval').value),
    defaultCurrency: document.getElementById('default-currency').value,
    historyMaxPoints: Math.max(50, Math.min(5000, Number(document.getElementById('history-max').value))),
  };

  try {
    await send({ type: MSG.UPDATE_SETTINGS, data });
    showStatus('save-status', 'Saved!', 'ok');
  } catch (err) {
    showStatus('save-status', `Error: ${err.message}`, 'err');
  }
});

// ── Export ────────────────────────────────────────────────────────────────

document.getElementById('btn-export').addEventListener('click', async () => {
  try {
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get(null),
    ]);
    const json = JSON.stringify({ sync: syncData, local: localData }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pricewatch-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus('data-status', 'Export complete.', 'ok');
  } catch (err) {
    showStatus('data-status', `Export failed: ${err.message}`, 'err');
  }
});

// ── Import ────────────────────────────────────────────────────────────────

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid backup file format');
    // Support both new { sync, local } format and old local-only format
    const syncData = data.sync ?? {};
    const localData = data.local ?? data;
    await Promise.all([
      chrome.storage.sync.clear().then(() => chrome.storage.sync.set(syncData)),
      chrome.storage.local.clear().then(() => chrome.storage.local.set(localData)),
    ]);
    showStatus('data-status', 'Import complete. Reload the extension to apply.', 'ok');
  } catch (err) {
    showStatus('data-status', `Import failed: ${err.message}`, 'err');
  }
  e.target.value = '';
});

// ── Clear all data ────────────────────────────────────────────────────────

document.getElementById('btn-clear').addEventListener('click', async () => {
  if (!confirm('This will delete all tracked products and history. Are you sure?')) return;
  try {
    await Promise.all([chrome.storage.sync.clear(), chrome.storage.local.clear()]);
    showStatus('data-status', 'All data cleared.', 'ok');
  } catch (err) {
    showStatus('data-status', `Error: ${err.message}`, 'err');
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────

function showStatus(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `status-msg ${type}`;
  setTimeout(() => { el.className = 'status-msg hidden'; }, 3000);
}

// ── Init ──────────────────────────────────────────────────────────────────

updateNotifStatus();
loadSettings();
