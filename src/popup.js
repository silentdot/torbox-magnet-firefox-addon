/* ─── State ─── */
const THEME_KEY = 'torbox_theme';
const API_KEY   = 'torbox_api_key';

/* ─── DOM refs ─── */
const $ = (id) => document.getElementById(id);

const themeToggle  = $('theme-toggle');

const apiSection   = $('api-section');
const apiInput     = $('api-key');
const saveKeyBtn   = $('save-key');
const keyStatus    = $('key-status');
const statusBar    = $('api-status-bar');
const statusDot    = statusBar?.querySelector('.status-dot');
const statusText   = $('status-text');
const changeKeyBtn = $('change-key-btn');
const actionSection = $('action-section');
const pageDomain   = $('page-domain');
const sendPageBtn  = $('send-page');
const actionStatus = $('action-status');
const historyWrapper = $('history-wrapper');
const historyEl    = $('history-section');
const clearHistBtn = $('clear-history');
const dashboardBtn = $('open-dashboard');
const toastEl      = $('toast');

/* ─── Storage helpers ─── */
async function get(key) {
  const r = await browser.storage.local.get(key);
  return r[key];
}
async function set(key, val) {
  await browser.storage.local.set({ [key]: val });
}

/* ─── Theme ─── */
function applyTheme(t) {
  document.body.setAttribute('data-theme', t || 'dark');
}

async function toggleTheme() {
  const cur = document.body.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  themeToggle.textContent = next === 'dark' ? '☀' : '☾';
  await set(THEME_KEY, next);
}

async function initTheme() {
  applyTheme(await get(THEME_KEY) || 'dark');
}

/* ─── Toast ─── */
let toastTimer;

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
}

/* ─── Validate & Connect API Key ─── */
async function validateAndConnect(key) {
  setStatus(keyStatus, 'Connecting…');
  const result = await browser.runtime.sendMessage({ type: 'validate-apikey', apiKey: key });

  if (result.valid) {
    await set(API_KEY, key);
    setStatus(keyStatus, 'Connected ✓', 'success');
    showApiStatus(true, result.email || 'Connected');
    apiSection.classList.add('hidden');
    showActions();
    loadHistory();
    return true;
  } else {
    setStatus(keyStatus, result.error || 'Invalid key', 'error');
    showApiStatus(false, 'Disconnected');
    return false;
  }
}

async function saveApiKey() {
  const key = apiInput.value.trim();
  if (!key) {
    setStatus(keyStatus, 'Please enter an API key.', 'error');
    return;
  }
  await validateAndConnect(key);
}

/* ─── API Status Bar ─── */
function showApiStatus(connected, msg) {
  statusBar.classList.remove('hidden');
  statusDot.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
  statusText.textContent = msg || (connected ? 'Connected' : 'Disconnected');
}

function hideApiStatus() {
  statusBar.classList.add('hidden');
}

/* ─── Init state from storage ─── */
async function initApiKey() {
  const key = await get(API_KEY);
  if (key) {
    apiInput.value = key;
    showApiStatus(false, 'Checking…');
    await validateAndConnect(key);
  }
}

/* ─── Actions ─── */
function showActions() {
  actionSection.classList.remove('hidden');
  historyWrapper.classList.remove('hidden');
  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    if (tabs[0]?.url) {
      try {
        pageDomain.textContent = new URL(tabs[0].url).hostname;
      } catch { pageDomain.textContent = tabs[0].url; }
    }
  });
}

async function sendCurrentPageMagnets() {
  const key = await get(API_KEY);
  if (!key) { setStatus(actionStatus, 'No API key set.', 'error'); return; }

  setStatus(actionStatus, 'Searching page for magnets…');
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return;

  try {
    const [results] = await browser.tabs.executeScript(tabs[0].id, {
      code: `Array.from(document.querySelectorAll('a[href^="magnet:"]')).map(a => a.href)`
    });
    const magnets = results || [];
    if (magnets.length === 0) {
      setStatus(actionStatus, 'No magnet links found on this page.', 'error');
      return;
    }

    setStatus(actionStatus, `Sending ${magnets.length} magnet(s)…`);

    for (const magnet of magnets) {
      const fd = new FormData();
      fd.append('magnet', magnet);
      fd.append('allow_zip', 'true');
      await fetch('https://api.torbox.app/v1/api/torrents/createtorrent', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}` },
        body: fd
      });
    }

    setStatus(actionStatus, `${magnets.length} magnet(s) sent!`, 'success');
    loadHistory();
  } catch (err) {
    setStatus(actionStatus, 'Error: ' + err.message, 'error');
  }
}

/* ─── History ─── */
async function loadHistory() {
  const result = await browser.runtime.sendMessage({ type: 'get-history' });
  const history = result.history || [];

  historyWrapper.classList.remove('hidden');

  if (history.length === 0) {
    historyEl.innerHTML = '<div class="history-empty">No downloads yet — right-click a magnet link and send it to TorBox.</div>';
    return;
  }

  historyEl.innerHTML = history.map((entry, i) => {
    const time = new Date(entry.timestamp).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const badge = entry.cached
      ? '<span class="history-item-badge badge-cached">ZIP</span>'
      : '<span class="history-item-badge badge-queued">Queue</span>';
    const name = entry.name && entry.name !== 'Unknown'
      ? entry.name
      : (entry.hash ? entry.hash.substring(0, 16) + '…' : 'Magnet');

    return `<div class="history-item" data-index="${i}" data-hash="${entry.hash || ''}" data-torrent-id="${entry.torrentId || ''}" data-name="${escapeAttr(name)}" data-magnet="${escapeAttr(entry.magnet || '')}">
      <div class="history-item-content">
        <div class="history-item-name" title="${escapeAttr(name)}">${escapeHtml(name)}</div>
        <div class="history-item-meta">
          <span class="history-item-time">${time}</span>
          ${badge}
        </div>
      </div>
      <div class="history-item-actions">
        ${entry.cached && entry.torrentId
          ? `<button class="action-btn dl-btn" title="Download ZIP">⬇</button>`
          : `<button class="action-btn dl-btn" title="Open Dashboard" style="font-size:11px">☐</button>`}
        <button class="action-btn copy-btn" title="Copy magnet link">📋</button>
        <button class="action-btn del-btn" title="Remove">✕</button>
      </div>
    </div>`;
  }).join('');
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ─── History event delegation ─── */
historyEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('.action-btn');
  if (!btn) return;

  const item = btn.closest('.history-item');
  if (!item) return;

  const hash = item.dataset.hash;
  const name = item.dataset.name || 'Unknown';
  const torrentId = item.dataset.torrentId;
  const magnet = item.dataset.magnet;

  if (btn.classList.contains('dl-btn')) {
    if (torrentId) {
      await browser.runtime.sendMessage({ type: 're-download', torrentId: Number(torrentId), name });
      showToast('Downloading…');
    } else {
      browser.runtime.sendMessage({ type: 'open-dashboard' });
    }
  } else if (btn.classList.contains('copy-btn')) {
    try {
      await navigator.clipboard.writeText(magnet);
      showToast('Copied!');
    } catch {
      showToast('Copy failed');
    }
  } else if (btn.classList.contains('del-btn')) {
    if (hash) {
      await browser.runtime.sendMessage({ type: 'delete-history-entry', hash });
    }
    await loadHistory();
  }
});

/* ─── Clear history ─── */
clearHistBtn.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'clear-history' });
  await loadHistory();
});

/* ─── Open dashboard ─── */
dashboardBtn.addEventListener('click', () => {
  browser.runtime.sendMessage({ type: 'open-dashboard' });
});

/* ─── Options ─── */
$('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

/* ─── Events ─── */
themeToggle.addEventListener('click', toggleTheme);
saveKeyBtn.addEventListener('click', saveApiKey);
sendPageBtn.addEventListener('click', sendCurrentPageMagnets);

changeKeyBtn.addEventListener('click', () => {
  hideApiStatus();
  apiSection.classList.remove('hidden');
  apiInput.focus();
});

// Enter key in API input
apiInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveApiKey();
});

/* ─── Status helper ─── */
function setStatus(el, text, type = '') {
  el.textContent = text;
  el.className = 'status' + (type ? ' ' + type : '');
}

/* ─── Boot ─── */
(async () => {
  await initTheme();
  await initApiKey();
})();
