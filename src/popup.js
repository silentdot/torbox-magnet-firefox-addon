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
  magnets: [],
  history: [],
  failedUrls: [],
  scanning: false,
  scanFailed: false,
  sending: false,
  activeView: 'loading'
};

var appLoading = $('app-loading');
var mainContent = $('main-content');
var connectPanel = $('connect-panel');
var magnetPicker = $('magnet-picker');
var historyView = $('history-view');
var setupBack = $('setup-back');
var setupTitle = $('setup-title');
var setupDescription = $('setup-description');
var apiInput = $('api-key');
var saveKeyButton = $('save-key');
var keyStatus = $('key-status');
var connectionAlert = $('connection-alert');
var pageDomain = $('page-domain');
var magnetCount = $('magnet-count');
var sendPageButton = $('send-page');
var sendButtonLabel = $('send-button-label');
var sendButtonIcon = $('send-button-icon');
var sendButtonSpinner = $('send-button-spinner');
var scanMessage = $('scan-message');
var rescanButton = $('rescan-page');
var actionWorkflow = $('action-workflow');
var actionResult = $('action-result');
var actionError = $('action-error');
var resultTitle = $('result-title');
var resultDetail = $('result-detail');
var actionErrorDetail = $('action-error-detail');
var recentHistory = $('recent-history');
var fullHistory = $('full-history');
var viewAllHistory = $('view-all-history');
var historyCount = $('history-count');
var magnetList = $('magnet-list');
var sendSelectedButton = $('send-selected');
var selectAllButton = $('picker-select-all');
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
  magnetPicker.classList.toggle('hidden', name !== 'picker');
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

function showSetup(isAccountChange, message) {
  setupBack.classList.toggle('hidden', !isAccountChange);
  setupTitle.textContent = isAccountChange ? 'Update connection' : 'Connect to TorBox';
  setupDescription.textContent = isAccountChange
    ? 'Enter a different API key to change the TorBox account used by this extension.'
    : 'Send magnets from any page directly to your TorBox account.';
  saveKeyButton.textContent = isAccountChange ? 'Save connection' : 'Connect account';
  apiInput.value = '';
  setKeyStatus(message || '', Boolean(message));
  showView('connect');
  setTimeout(function () { apiInput.focus(); }, 0);
}

async function initialiseApiKey() {
  var key = await getStored(API_KEY);
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
  scanCurrentPage();
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

function getMagnetName(url, anchorLabel, index) {
  try {
    var parsed = new URL(url);
    var displayName = parsed.searchParams.get('dn');
    if (displayName) return displayName;
  } catch (error) {}
  if (anchorLabel && anchorLabel.length > 1 && anchorLabel.length < 140) return anchorLabel;
  return 'Magnet ' + (index + 1);
}

function getMagnetHash(url) {
  var match = url.match(/btih:([a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[A-Z2-7]{32})/);
  return match ? match[1].toLowerCase() : url.slice(0, 54);
}

async function scanCurrentPage() {
  if (state.scanning) return;
  state.scanning = true;
  state.scanFailed = false;
  showActionWorkflow();
  renderScanState();
  focusSoon(sendPageButton);

  try {
    var tabs = await browser.tabs.query({ active: true, currentWindow: true });
    var tab = tabs[0];
    if (!tab) throw new Error('No active page');

    if (tab.url) {
      try {
        pageDomain.textContent = new URL(tab.url).hostname || 'Current page';
      } catch (error) {
        pageDomain.textContent = 'Current page';
      }
    }

    var results = await browser.tabs.executeScript(tab.id, {
      code: 'Array.from(document.querySelectorAll(\'a[href^="magnet:"]\')).map(function(a){return {url:a.href,label:(a.textContent||"").trim()};})'
    });
    var found = results[0] || [];
    var seen = {};
    state.magnets = [];
    for (var i = 0; i < found.length; i++) {
      if (!found[i].url || seen[found[i].url]) continue;
      seen[found[i].url] = true;
      state.magnets.push({
        url: found[i].url,
        name: getMagnetName(found[i].url, found[i].label, state.magnets.length),
        hash: getMagnetHash(found[i].url)
      });
    }
  } catch (error) {
    state.magnets = [];
    state.scanFailed = true;
    pageDomain.textContent = 'This page cannot be scanned';
  } finally {
    state.scanning = false;
    renderScanState();
    if (state.activeView === 'main') {
      focusSoon(state.magnets.length === 0 ? rescanButton : sendPageButton);
    }
  }
}

function renderScanState() {
  var count = state.magnets.length;
  sendButtonSpinner.classList.toggle('hidden', !state.scanning);
  sendButtonIcon.classList.toggle('hidden', state.scanning);
  rescanButton.classList.toggle('hidden', state.scanning || count > 0);
  scanMessage.classList.toggle('hidden', state.scanning || count > 0);

  if (state.scanning) {
    magnetCount.textContent = 'Scanning';
    sendButtonLabel.textContent = 'Scanning page...';
    sendPageButton.disabled = false;
    sendPageButton.setAttribute('aria-disabled', 'true');
    return;
  }

  if (count === 0) {
    magnetCount.textContent = 'None found';
    sendButtonLabel.textContent = 'No magnets found';
    scanMessage.textContent = state.scanFailed
      ? 'Firefox could not scan this page. Try again or open a different page.'
      : 'This page does not contain any magnet links.';
    sendPageButton.disabled = true;
    sendPageButton.removeAttribute('aria-disabled');
    return;
  }

  magnetCount.textContent = count + (count === 1 ? ' magnet' : ' magnets');
  sendButtonLabel.textContent = count === 1 ? 'Send magnet' : 'Choose ' + count + ' magnets';
  sendPageButton.disabled = false;
  sendPageButton.removeAttribute('aria-disabled');
}

function showActionWorkflow() {
  actionWorkflow.classList.remove('hidden');
  actionResult.classList.add('hidden');
  actionError.classList.add('hidden');
}

function showMagnetPicker() {
  magnetList.replaceChildren();
  for (var i = 0; i < state.magnets.length; i++) {
    var magnet = state.magnets[i];
    var choice = createElement('label', 'magnet-choice');
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(i);
    checkbox.checked = true;
    var copy = createElement('span', 'magnet-choice-copy');
    var name = createElement('span', 'magnet-choice-name', magnet.name);
    name.title = magnet.name;
    copy.appendChild(name);
    copy.appendChild(createElement('span', 'magnet-choice-detail', magnet.hash));
    choice.appendChild(checkbox);
    choice.appendChild(copy);
    magnetList.appendChild(choice);
  }
  updatePickerControls();
  showView('picker');
  focusSoon($('picker-back'));
}

function selectedMagnets() {
  var checked = magnetList.querySelectorAll('input:checked');
  var selected = [];
  for (var i = 0; i < checked.length; i++) {
    selected.push(state.magnets[Number(checked[i].value)]);
  }
  return selected;
}

function updatePickerControls() {
  var selectedCount = magnetList.querySelectorAll('input:checked').length;
  var allSelected = selectedCount === state.magnets.length;
  selectAllButton.textContent = allSelected ? 'Clear all' : 'Select all';
  sendSelectedButton.disabled = selectedCount === 0;
  sendSelectedButton.textContent = selectedCount === 0
    ? 'Select at least one'
    : 'Send ' + selectedCount + (selectedCount === 1 ? ' magnet' : ' magnets');
}

async function sendMagnets(magnets) {
  if (state.sending || magnets.length === 0) return;
  state.sending = true;
  state.failedUrls = magnets.map(function (magnet) { return magnet.url; });
  showView('main');
  showActionWorkflow();
  sendPageButton.disabled = false;
  sendPageButton.setAttribute('aria-disabled', 'true');
  sendButtonIcon.classList.add('hidden');
  sendButtonSpinner.classList.remove('hidden');
  sendButtonLabel.textContent = 'Sending ' + magnets.length + (magnets.length === 1 ? ' magnet...' : ' magnets...');
  rescanButton.classList.add('hidden');
  focusSoon(sendPageButton);

  try {
    var response = await browser.runtime.sendMessage({
      type: 'send-page-magnets',
      urls: magnets.map(function (magnet) { return magnet.url; })
    });
    if (!response || !response.ok) throw new Error((response && response.error) || 'TorBox could not process these magnets.');

    var downloaded = 0;
    var queued = 0;
    var errors = 0;
    for (var i = 0; i < response.results.length; i++) {
      if (response.results[i].status === 'downloaded') downloaded++;
      else if (response.results[i].status === 'queued') queued++;
      else errors++;
    }

    var successful = downloaded + queued;
    state.sending = false;
    if (successful === 0) {
      showSendError('TorBox could not process the selected ' + (magnets.length === 1 ? 'magnet.' : 'magnets.'));
    } else {
      state.failedUrls = [];
      showSendResult(successful, magnets.length, downloaded, queued);
      if (errors > 0) showToast(errors + (errors === 1 ? ' magnet failed' : ' magnets failed'), 'error');
    }
    await loadHistory();
  } catch (error) {
    state.sending = false;
    showSendError(error.message || 'TorBox could not process these magnets.');
  }
}

function showSendResult(successful, total, downloaded, queued) {
  actionWorkflow.classList.add('hidden');
  actionError.classList.add('hidden');
  actionResult.classList.remove('hidden');
  resultTitle.textContent = successful === total
    ? (successful === 1 ? 'Magnet sent to TorBox' : successful + ' magnets sent to TorBox')
    : successful + ' of ' + total + ' magnets sent';
  var details = [];
  if (downloaded) details.push(downloaded + ' ready to download');
  if (queued) details.push(queued + ' queued');
  resultDetail.textContent = details.join('  /  ');
  focusSoon($('scan-again'));
}

function showSendError(message) {
  actionWorkflow.classList.add('hidden');
  actionResult.classList.add('hidden');
  actionError.classList.remove('hidden');
  actionErrorDetail.textContent = message;
  focusSoon($('retry-send'));
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
    container.appendChild(createElement('div', 'empty-state', 'Nothing here yet. Send a magnet from this page or use the right-click menu.'));
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
    var canShare = entry.hash || entry.torrentId;
    var canDelete = Boolean(entry.hash);

    var item = createElement('article', 'history-item');
    item.dataset.hash = entry.hash || '';
    item.dataset.torrentId = entry.torrentId || '';
    item.dataset.name = name;

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
    if (canShare) actions.appendChild(createHistoryAction('share', 'link', 'Copy share link', false));
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
  var hash = item.dataset.hash;
  var torrentId = Number(item.dataset.torrentId || 0);
  var name = item.dataset.name || 'Magnet';

  if (action === 'download' && torrentId) {
    var downloadResult = await browser.runtime.sendMessage({ type: 're-download', torrentId: torrentId, name: name });
    showToast(downloadResult && downloadResult.ok ? 'Download starting' : 'Download could not start', downloadResult && downloadResult.ok ? '' : 'error');
  } else if (action === 'dashboard') {
    await browser.runtime.sendMessage({ type: 'open-dashboard' });
  } else if (action === 'share') {
    var shareResult = await browser.runtime.sendMessage({ type: 'copy-share-link', torrentId: torrentId, hash: hash });
    showToast(shareResult && shareResult.ok ? 'Share link copied' : 'No share link available', shareResult && shareResult.ok ? '' : 'error');
  } else if (action === 'delete' && hash) {
    await browser.runtime.sendMessage({ type: 'delete-history-entry', hash: hash });
    await loadHistory();
    if (state.activeView === 'history') focusSoon($('history-back'));
    else focusSoon(recentHistory.querySelector('.history-action') || sendPageButton);
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

sendPageButton.addEventListener('click', function () {
  if (state.scanning || state.sending) return;
  if (state.magnets.length === 1) sendMagnets([state.magnets[0]]);
  else if (state.magnets.length > 1) showMagnetPicker();
});
rescanButton.addEventListener('click', scanCurrentPage);
$('scan-again').addEventListener('click', scanCurrentPage);
$('retry-send').addEventListener('click', function () {
  var retryMagnets = state.magnets.filter(function (magnet) { return state.failedUrls.indexOf(magnet.url) !== -1; });
  sendMagnets(retryMagnets);
});

magnetList.addEventListener('change', updatePickerControls);
selectAllButton.addEventListener('click', function () {
  var inputs = magnetList.querySelectorAll('input');
  var shouldSelect = magnetList.querySelectorAll('input:checked').length !== inputs.length;
  for (var i = 0; i < inputs.length; i++) inputs[i].checked = shouldSelect;
  updatePickerControls();
});
sendSelectedButton.addEventListener('click', function () { sendMagnets(selectedMagnets()); });
$('picker-back').addEventListener('click', function () {
  showView('main');
  focusSoon(sendPageButton);
});

recentHistory.addEventListener('click', handleHistoryClick);
fullHistory.addEventListener('click', handleHistoryClick);
viewAllHistory.addEventListener('click', function () {
  showView('history');
  focusSoon($('history-back'));
});
$('history-back').addEventListener('click', function () {
  showView('main');
  focusSoon(viewAllHistory.classList.contains('hidden') ? sendPageButton : viewAllHistory);
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

$('update-dismiss').addEventListener('click', function () {
  $('update-banner').classList.add('hidden');
  focusSoon(settingsToggle);
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
  else if (state.activeView === 'picker') {
    showView('main');
    focusSoon(sendPageButton);
  } else if (state.activeView === 'history') {
    showView('main');
    focusSoon(viewAllHistory.classList.contains('hidden') ? sendPageButton : viewAllHistory);
  } else if (state.activeView === 'connect' && state.connected) {
    showView('main');
    focusSoon(settingsToggle);
  }
});

(async function initialise() {
  var manifest = browser.runtime.getManifest();
  $('extension-version').textContent = manifest.version;
  await initialiseApiKey();
  checkForUpdate(false);
})();
