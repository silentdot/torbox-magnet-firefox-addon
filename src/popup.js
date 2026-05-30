/* ─── State ─── */
const THEME_KEY = 'torbox_theme';
const API_KEY   = 'torbox_api_key';

/* ─── DOM refs ─── */
const themeToggle = document.getElementById('theme-toggle');
const themeIcon   = document.querySelector('.theme-icon');
const apiInput    = document.getElementById('api-key');
const saveKeyBtn  = document.getElementById('save-key');
const keyStatus   = document.getElementById('key-status');
const actionSection = document.getElementById('action-section');
const pageDomain  = document.getElementById('page-domain');
const sendPageBtn = document.getElementById('send-page');
const actionStatus = document.getElementById('action-status');
const openOptions = document.getElementById('open-options');

/* ─── Helpers ─── */
async function getStored(key) {
  const res = await browser.storage.local.get(key);
  return res[key];
}

async function setStored(key, value) {
  await browser.storage.local.set({ [key]: value });
}

function setStatus(el, text, type = '') {
  el.textContent = text;
  el.className = 'status' + (type ? ' ' + type : '');
}

/* ─── Theme ─── */
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  themeIcon.textContent = theme === 'dark' ? '☀' : '☾';
}

async function toggleTheme() {
  const current = document.body.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await setStored(THEME_KEY, next);
}

async function initTheme() {
  const saved = await getStored(THEME_KEY);
  applyTheme(saved || 'dark');
}

/* ─── API Key ─── */
async function initApiKey() {
  const key = await getStored(API_KEY);
  if (key) {
    apiInput.value = key;
    showActions();
  }
}

async function saveApiKey() {
  const key = apiInput.value.trim();
  if (!key) {
    setStatus(keyStatus, 'Please enter an API key.', 'error');
    return;
  }
  await setStored(API_KEY, key);
  setStatus(keyStatus, 'API key saved!', 'success');
  showActions();
}

/* ─── Actions ─── */
async function showActions() {
  actionSection.classList.remove('hidden');
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0] && tabs[0].url) {
    try {
      const url = new URL(tabs[0].url);
      pageDomain.textContent = url.hostname;
    } catch {
      pageDomain.textContent = tabs[0].url;
    }
  }
}

async function sendCurrentPageMagnets() {
  const key = await getStored(API_KEY);
  if (!key) {
    setStatus(actionStatus, 'No API key set.', 'error');
    return;
  }

  setStatus(actionStatus, 'Searching page for magnets…');

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return;

  try {
    const results = await browser.tabs.executeScript(tabs[0].id, {
      code: `Array.from(document.querySelectorAll('a[href^="magnet:"]')).map(a => a.href)`
    });
    const magnets = results[0] || [];

    if (magnets.length === 0) {
      setStatus(actionStatus, 'No magnet links found on this page.', 'error');
      return;
    }

    setStatus(actionStatus, `Sending ${magnets.length} magnet(s)…`);

    for (const magnet of magnets) {
      const formData = new FormData();
      formData.append('magnet', magnet);
      formData.append('allow_zip', 'true');

      await fetch('https://api.torbox.app/v1/api/torrents/createtorrent', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`
        },
        body: formData
      });
    }

    setStatus(actionStatus, `${magnets.length} magnet(s) sent!`, 'success');
  } catch (err) {
    setStatus(actionStatus, 'Error: ' + err.message, 'error');
  }
}

/* ─── Options page ─── */
function openOptionsPage(e) {
  e.preventDefault();
  browser.runtime.openOptionsPage();
}

/* ─── Events ─── */
themeToggle.addEventListener('click', toggleTheme);
saveKeyBtn.addEventListener('click', saveApiKey);
sendPageBtn.addEventListener('click', sendCurrentPageMagnets);
openOptions.addEventListener('click', openOptionsPage);

/* ─── Boot ─── */
(async () => {
  await initTheme();
  await initApiKey();
})();
