const THEME_KEY = 'torbox_theme';
const API_KEY   = 'torbox_api_key';

const apiInput  = document.getElementById('opt-api-key');
const saveBtn   = document.getElementById('opt-save');
const statusEl  = document.getElementById('opt-status');
const themeBtn  = document.getElementById('opt-theme-toggle');

async function getStored(key) {
  const res = await browser.storage.local.get(key);
  return res[key];
}

async function setStored(key, value) {
  await browser.storage.local.set({ [key]: value });
}

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (type ? ' ' + type : '');
}

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
}

async function init() {
  const theme = await getStored(THEME_KEY);
  applyTheme(theme || 'dark');

  const key = await getStored(API_KEY);
  if (key) apiInput.value = key;
}

saveBtn.addEventListener('click', async () => {
  const key = apiInput.value.trim();
  if (!key) {
    setStatus('Please enter an API key.', 'error');
    return;
  }
  await setStored(API_KEY, key);
  setStatus('Saved successfully!', 'success');
});

themeBtn.addEventListener('click', async () => {
  const current = document.body.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await setStored(THEME_KEY, next);
});

init();
