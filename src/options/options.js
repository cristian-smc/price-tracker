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
  document.getElementById('sound-enabled').checked = settings.soundEnabled ?? true;
  document.getElementById('mobile-push-url').value = settings.mobilePushUrl ?? '';
  document.getElementById('digest-enabled').checked = settings.dailyDigestEnabled ?? false;
  setSelectValue('digest-hour', String(settings.dailyDigestHour ?? 9));
  setSelectValue('theme', settings.theme ?? 'auto');
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
    soundEnabled: document.getElementById('sound-enabled').checked,
    mobilePushUrl: document.getElementById('mobile-push-url').value.trim(),
    dailyDigestEnabled: document.getElementById('digest-enabled').checked,
    dailyDigestHour: Number(document.getElementById('digest-hour').value),
    theme: document.getElementById('theme').value,
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

// ── Export JSON ───────────────────────────────────────────────────────────

document.getElementById('btn-export-json').addEventListener('click', async () => {
  try {
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get(null),
    ]);
    const json = JSON.stringify({ sync: syncData, local: localData }, null, 2);
    downloadBlob(json, `pricewatch-backup-${today()}.json`, 'application/json');
    showStatus('data-status', 'Export complete.', 'ok');
  } catch (err) {
    showStatus('data-status', `Export failed: ${err.message}`, 'err');
  }
});

// ── Export CSV ────────────────────────────────────────────────────────────

document.getElementById('btn-export-csv').addEventListener('click', async () => {
  try {
    const { products } = await send({ type: MSG.GET_PRODUCTS });
    const rows = [['Name', 'URL', 'Current Price', 'Currency', 'Target Price', 'Lowest Price', 'Highest Price', 'Stock', 'Enabled', 'Last Checked']];
    for (const p of Object.values(products ?? {})) {
      rows.push([
        csvEscape(p.name),
        csvEscape(p.url),
        centsToStr(p.currentPrice),
        p.currency ?? '',
        centsToStr(p.targetPrice),
        centsToStr(p.lowestPrice),
        centsToStr(p.highestPrice),
        p.currentStock ?? '',
        p.enabled ? 'yes' : 'no',
        p.lastChecked ? new Date(p.lastChecked).toISOString() : '',
      ]);
    }
    const csv = rows.map((r) => r.join(',')).join('\n');
    downloadBlob(csv, `pricewatch-${today()}.csv`, 'text/csv');
    showStatus('data-status', 'CSV exported.', 'ok');
  } catch (err) {
    showStatus('data-status', `CSV export failed: ${err.message}`, 'err');
  }
});

// ── Import backup ─────────────────────────────────────────────────────────

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

// ── Bulk URL import ───────────────────────────────────────────────────────

document.getElementById('btn-bulk-import').addEventListener('click', async () => {
  const raw = document.getElementById('bulk-urls').value.trim();
  if (!raw) return;

  const urls = raw.split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      try { new URL(l); return true; } catch { return false; }
    });

  if (urls.length === 0) {
    showStatus('bulk-status', 'No valid URLs found.', 'err');
    return;
  }

  try {
    const { added } = await send({ type: MSG.IMPORT_URLS, urls });
    document.getElementById('bulk-urls').value = '';
    showStatus('bulk-status', `Added ${added} product${added === 1 ? '' : 's'}.`, 'ok');
  } catch (err) {
    showStatus('bulk-status', `Import failed: ${err.message}`, 'err');
  }
});

// ── Test mobile push ──────────────────────────────────────────────────────

document.getElementById('btn-test-push').addEventListener('click', async () => {
  const url = document.getElementById('mobile-push-url').value.trim();
  if (!url) {
    showStatus('push-status', 'Enter a URL first.', 'err');
    return;
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Title': 'PriceWatch test', 'Content-Type': 'text/plain' },
      body: 'Your mobile push notifications are working!',
    });
    if (resp.ok) {
      showStatus('push-status', 'Sent!', 'ok');
    } else {
      showStatus('push-status', `Server returned ${resp.status}`, 'err');
    }
  } catch (err) {
    showStatus('push-status', `Failed: ${err.message}`, 'err');
  }
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

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function centsToStr(v) {
  return v == null ? '' : (v / 100).toFixed(2);
}

function csvEscape(str) {
  const s = String(str ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

// ── Init ──────────────────────────────────────────────────────────────────

await updateNotifStatus();
await loadSettings();
