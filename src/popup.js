var API_KEY = 'torbox_api_key';
var RECENT_HISTORY_LIMIT = 3;

function $(id) { return document.getElementById(id); }
function createIcon(name, size) {
  var iconSize = String(size || 14);
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  svg.setAttribute('width', iconSize);
  svg.setAttribute('height', iconSize);
  svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', '#i-' + name);
  svg.appendChild(use);
  return svg;
}

function createElement(tagName, className, text) {
  var element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

var state = {
  connected: false,
  email: '',
  apiKey: '',
  history: [],
  activeView: 'loading'
};

var appLoading = $('app-loading');
var mainContent = $('main-content');
var connectPanel = $('connect-panel');
var historyView = $('history-view');
var setupBack = $('setup-back');
var setupTitle = $('setup-title');
var setupDescription = $('setup-description');
var apiInput = $('api-key');
var saveKeyButton = $('save-key');
var keyStatus = $('key-status');
var connectionAlert = $('connection-alert');
var recentHistory = $('recent-history');
var fullHistory = $('full-history');
var viewAllHistory = $('view-all-history');
var historyCount = $('history-count');
var settingsToggle = $('settings-toggle');
var settingsMenu = $('settings-menu');
var settingsAccountLabel = $('settings-account-label');
var confirmDialog = $('confirm-dialog');
var toast = $('toast');

async function getStored(key) {
  var result = await browser.storage.local.get(key);
  return result[key];
}

async function setStored(key, value) {
  var item = {};
  item[key] = value;
  await browser.storage.local.set(item);
}

function showView(name) {
  state.activeView = name;
  appLoading.classList.toggle('hidden', name !== 'loading');
  mainContent.classList.toggle('hidden', name !== 'main');
  connectPanel.classList.toggle('hidden', name !== 'connect');
  historyView.classList.toggle('hidden', name !== 'history');
  closeSettings(false);
}

function focusSoon(element) {
  if (!element) return;
  requestAnimationFrame(function () { element.focus(); });
}

var toastTimer;
function showToast(message, type) {
  toast.textContent = message;
  toast.className = 'toast' + (type ? ' ' + type : '');
  requestAnimationFrame(function () { toast.classList.add('show'); });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2200);
}

function setKeyStatus(message, isError) {
  keyStatus.textContent = message;
  keyStatus.className = 'form-status' + (isError ? ' error' : '');
}

function buildDownloadLink(torrentId, apiKey, zipWrap, fileId) {
  return DownloadLogic.buildDownloadLink(torrentId, apiKey, { zip: zipWrap, fileId: fileId });
}

function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }

  var textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  var copied = document.execCommand('copy');
  textarea.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error('Clipboard write failed'));
}

function showSetup(isAccountChange, message) {
  setupBack.classList.toggle('hidden', !isAccountChange);
  setupTitle.textContent = isAccountChange ? 'Update connection' : 'Connect to TorBox';
  setupDescription.textContent = isAccountChange
    ? 'Enter a different API key to change the TorBox account used by this extension.'
    : 'Right-click a magnet or .torrent link to send it to TorBox and start the download.';
  saveKeyButton.textContent = isAccountChange ? 'Save connection' : 'Connect account';
  apiInput.value = '';
  setKeyStatus(message || '', Boolean(message));
  showView('connect');
  setTimeout(function () { apiInput.focus(); }, 0);
}

async function initialiseApiKey() {
  var key = await getStored(API_KEY);
  state.apiKey = key || '';
  if (!key) {
    showSetup(false);
    return;
  }

  var cachedStatus = await browser.runtime.sendMessage({ type: 'get-apikey-status' });
  if (cachedStatus && cachedStatus.valid) {
    showConnected(cachedStatus.email || 'Connected');
    return;
  }

  var result = await browser.runtime.sendMessage({ type: 'validate-apikey', apiKey: key });
  if (result && result.valid) {
    showConnected(result.email || 'Connected');
    return;
  }

  connectionAlert.classList.remove('hidden');
  showSetup(false, 'Your connection expired. Enter your API key again.');
}

function showConnected(email) {
  state.connected = true;
  state.email = email;
  settingsAccountLabel.textContent = email;
  connectionAlert.classList.add('hidden');
  showView('main');
  loadHistory().then(refreshHistoryInBackground);
}

async function saveApiKey() {
  var key = apiInput.value.trim();
  if (!key) {
    setKeyStatus('Enter your TorBox API key.', true);
    return;
  }

  saveKeyButton.disabled = true;
  saveKeyButton.textContent = 'Connecting...';
  setKeyStatus('Checking your connection...', false);
  try {
    var result = await browser.runtime.sendMessage({ type: 'validate-apikey', apiKey: key });
    if (!result || !result.valid) {
      setKeyStatus((result && result.error) || 'That API key could not be validated.', true);
      return;
    }
    await setStored(API_KEY, key);
    state.apiKey = key;
    setKeyStatus('', false);
    showConnected(result.email || 'Connected');
    showToast('TorBox connected');
  } catch (error) {
    setKeyStatus(error.message || 'Could not connect to TorBox.', true);
  } finally {
    saveKeyButton.disabled = false;
    saveKeyButton.textContent = state.connected ? 'Save connection' : 'Connect account';
  }
}

async function loadHistory() {
  try {
    var result = await browser.runtime.sendMessage({ type: 'get-history' });
    state.history = (result && result.history) || [];
  } catch (error) {
    state.history = [];
  }
  renderHistory();
}

async function refreshHistoryInBackground() {
  try {
    var result = await browser.runtime.sendMessage({ type: 'refresh-history-cache' });
    if (result && result.history) {
      state.history = result.history;
      renderHistory();
    }
  } catch (error) {}
}

function formatHistoryTime(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderHistoryList(container, entries) {
  container.replaceChildren();
  if (!entries.length) {
    container.appendChild(createElement('div', 'empty-state', 'Nothing here yet. Right-click a magnet or .torrent link to start a download.'));
    return;
  }

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var name = entry.name && entry.name !== 'Unknown'
      ? entry.name
      : (entry.hash ? entry.hash.slice(0, 18) + '...' : 'Magnet');
    var primaryAction = entry.cached && entry.torrentId ? 'download' : 'dashboard';
    var primaryIcon = primaryAction === 'download' ? 'download' : 'grid';
    var primaryLabel = primaryAction === 'download' ? 'Download again' : 'Open TorBox dashboard';
    var canCopyLink = Boolean(entry.torrentId);
    var canDelete = true;

    var item = createElement('article', 'history-item');
    item.dataset.id = entry.id || '';
    item.dataset.hash = entry.hash || '';
    item.dataset.torrentId = entry.torrentId || '';
    item.dataset.name = name;
    item.dataset.zipWrap = entry.zipWrap === false ? 'false' : 'true';
    item.dataset.fileId = entry.fileId === undefined || entry.fileId === null ? '' : String(entry.fileId);
    item.dataset.downloadFilename = entry.downloadFilename || '';

    var content = createElement('div', 'history-content');
    var itemName = createElement('div', 'history-name', name);
    itemName.title = name;
    var meta = createElement('div', 'history-meta');
    var time = createElement('time', '', formatHistoryTime(entry.timestamp));
    var status = createElement('span', 'status-badge ' + (entry.cached ? 'status-ready' : 'status-queued'));
    status.appendChild(createIcon(entry.cached ? 'check' : 'clock', 10));
    status.appendChild(document.createTextNode(entry.cached ? ' Ready' : ' Queued'));
    meta.appendChild(time);
    meta.appendChild(status);
    content.appendChild(itemName);
    content.appendChild(meta);

    var actions = createElement('div', 'history-actions');
    actions.appendChild(createHistoryAction(primaryAction, primaryIcon, primaryLabel, false));
    if (canCopyLink) actions.appendChild(createHistoryAction('copy-link', 'link', 'Copy direct download link', false));
    if (canDelete) actions.appendChild(createHistoryAction('delete', 'close', 'Remove from history', true));

    item.appendChild(content);
    item.appendChild(actions);
    container.appendChild(item);
  }
}

function createHistoryAction(action, iconName, label, isDangerous) {
  var className = 'history-action' + (isDangerous ? ' history-action-danger' : '');
  var button = createElement('button', className);
  button.type = 'button';
  button.dataset.historyAction = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.appendChild(createIcon(iconName));
  return button;
}

function renderHistory() {
  renderHistoryList(recentHistory, state.history.slice(0, RECENT_HISTORY_LIMIT));
  renderHistoryList(fullHistory, state.history);
  historyCount.textContent = state.history.length + (state.history.length === 1 ? ' item' : ' items');
  viewAllHistory.classList.toggle('hidden', state.history.length <= RECENT_HISTORY_LIMIT);
}

async function handleHistoryClick(event) {
  var button = event.target.closest('[data-history-action]');
  if (!button) return;
  var item = button.closest('.history-item');
  if (!item) return;

  var action = button.dataset.historyAction;
  var id = item.dataset.id;
  var hash = item.dataset.hash;
  var torrentId = Number(item.dataset.torrentId || 0);
  var name = item.dataset.name || 'Magnet';
  var zipWrap = item.dataset.zipWrap !== 'false';
  var fileId = item.dataset.fileId;
  var downloadFilename = item.dataset.downloadFilename;

  if (action === 'download' && torrentId) {
    var downloadResult = await browser.runtime.sendMessage({ type: 're-download', torrentId: torrentId, name: name, zipWrap: zipWrap, fileId: fileId || null, downloadFilename: downloadFilename });
    showToast(downloadResult && downloadResult.ok ? 'Download starting' : 'Download could not start', downloadResult && downloadResult.ok ? '' : 'error');
  } else if (action === 'dashboard') {
    await browser.runtime.sendMessage({ type: 'open-dashboard' });
  } else if (action === 'copy-link' && torrentId) {
    var link = buildDownloadLink(torrentId, state.apiKey, zipWrap, fileId || null);
    if (!link) {
      showToast('Direct download link unavailable', 'error');
      return;
    }
    try {
      await copyTextToClipboard(link);
      showToast('Direct download link copied');
    } catch (error) {
      showToast('Direct download link could not be copied', 'error');
    }
  } else if (action === 'delete' && (hash || id)) {
    await browser.runtime.sendMessage({ type: 'delete-history-entry', hash: hash, id: id });
    await loadHistory();
    if (state.activeView === 'history') focusSoon($('history-back'));
    else focusSoon(recentHistory.querySelector('.history-action') || settingsToggle);
  }
}

function openSettings() {
  settingsMenu.classList.remove('hidden');
  settingsToggle.setAttribute('aria-expanded', 'true');
  var firstItem = settingsMenu.querySelector('.menu-item');
  if (firstItem) firstItem.focus();
}

function closeSettings(restoreFocus) {
  var wasOpen = !settingsMenu.classList.contains('hidden');
  settingsMenu.classList.add('hidden');
  settingsToggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus && wasOpen) settingsToggle.focus();
}

function toggleSettings() {
  if (settingsMenu.classList.contains('hidden')) openSettings();
  else closeSettings(false);
}

function showClearConfirmation() {
  closeSettings();
  confirmDialog.classList.remove('hidden');
  $('cancel-clear').focus();
}

function hideClearConfirmation() {
  confirmDialog.classList.add('hidden');
  settingsToggle.focus();
}

async function clearHistory() {
  var result = await browser.runtime.sendMessage({ type: 'clear-history' });
  if (!result || !result.ok) {
    hideClearConfirmation();
    showToast((result && result.error) || 'Local history could not be cleared', 'error');
    return;
  }
  hideClearConfirmation();
  await loadHistory();
  if (state.activeView === 'history') showView('main');
  showToast('Local history cleared');
}

function showUpdateBanner(update) {
  if (!update || !update.latest || update.latest === update.current) return;
  $('update-text').textContent = 'Version ' + update.latest + ' is available';
  if (update.url) $('update-link').href = update.url;
  $('update-banner').classList.remove('hidden');
}

async function checkForUpdate(manual) {
  var button = $('check-update');
  if (manual) {
    button.disabled = true;
  }
  try {
    var update = await browser.runtime.sendMessage({ type: manual ? 'check-update-now' : 'check-update' });
    if (update && update.latest && update.latest !== update.current) {
      showUpdateBanner(update);
      if (manual) showToast('Version ' + update.latest + ' is available');
    } else if (manual) {
      showToast('TorBox Magnet is up to date');
    }
  } finally {
    button.disabled = false;
  }
}

recentHistory.addEventListener('click', handleHistoryClick);
fullHistory.addEventListener('click', handleHistoryClick);
viewAllHistory.addEventListener('click', function () {
  showView('history');
  focusSoon($('history-back'));
});
$('history-back').addEventListener('click', function () {
  showView('main');
  focusSoon(viewAllHistory.classList.contains('hidden') ? settingsToggle : viewAllHistory);
});

saveKeyButton.addEventListener('click', saveApiKey);
apiInput.addEventListener('keydown', function (event) {
  if (event.key === 'Enter') saveApiKey();
});
setupBack.addEventListener('click', function () {
  showView('main');
  focusSoon(settingsToggle);
});
connectionAlert.addEventListener('click', function () { showSetup(state.connected, 'Enter your API key to reconnect.'); });

$('open-dashboard-top').addEventListener('click', function () {
  browser.runtime.sendMessage({ type: 'open-dashboard' });
});

settingsToggle.addEventListener('click', function (event) {
  event.stopPropagation();
  toggleSettings();
});
settingsMenu.addEventListener('click', function (event) { event.stopPropagation(); });
document.addEventListener('click', function () { closeSettings(false); });
$('open-dashboard').addEventListener('click', function () {
  browser.runtime.sendMessage({ type: 'open-dashboard' });
  closeSettings(false);
});
$('change-api-key').addEventListener('click', function () { showSetup(state.connected); });
$('check-update').addEventListener('click', function () { checkForUpdate(true); });
$('clear-history').addEventListener('click', showClearConfirmation);

$('cancel-clear').addEventListener('click', hideClearConfirmation);
$('confirm-clear').addEventListener('click', clearHistory);
confirmDialog.addEventListener('click', function (event) {
  if (event.target === confirmDialog) hideClearConfirmation();
});

$('update-link').addEventListener('click', function (event) {
  event.preventDefault();
  if (this.href && this.href !== '#' && this.href !== location.href) {
    browser.runtime.sendMessage({ type: 'open-update', url: this.href });
  }
});
$('update-dismiss').addEventListener('click', function () {
  $('update-banner').classList.add('hidden');
  focusSoon(settingsToggle);
});

$('workflow-dismiss').addEventListener('click', function () {
  $('workflow-panel').classList.add('hidden');
  setStored('workflow_hidden', true);
});

document.addEventListener('keydown', function (event) {
  if (!confirmDialog.classList.contains('hidden') && event.key === 'Tab') {
    var dialogButtons = confirmDialog.querySelectorAll('button');
    var firstButton = dialogButtons[0];
    var lastButton = dialogButtons[dialogButtons.length - 1];
    if (event.shiftKey && document.activeElement === firstButton) {
      event.preventDefault();
      lastButton.focus();
    } else if (!event.shiftKey && document.activeElement === lastButton) {
      event.preventDefault();
      firstButton.focus();
    }
    return;
  }
  if (event.key !== 'Escape') return;
  if (!confirmDialog.classList.contains('hidden')) hideClearConfirmation();
  else if (!settingsMenu.classList.contains('hidden')) closeSettings(true);
  else if (state.activeView === 'history') {
    showView('main');
    focusSoon(viewAllHistory.classList.contains('hidden') ? settingsToggle : viewAllHistory);
  } else if (state.activeView === 'connect' && state.connected) {
    showView('main');
    focusSoon(settingsToggle);
  }
});

(async function initialise() {
  var manifest = browser.runtime.getManifest();
  $('extension-version').textContent = manifest.version;
  if (await getStored('workflow_hidden')) $('workflow-panel').classList.add('hidden');
  await initialiseApiKey();
  checkForUpdate(false);
})();
