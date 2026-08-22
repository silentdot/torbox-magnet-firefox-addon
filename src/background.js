/**
 * TorBox Magnet — Background Script
 *
 * Supports magnet URIs and .torrent file URLs from the browser context menu.
 * The context-menu action adds the torrent to TorBox and starts a download
 * immediately when the content is available.
 */

/* --- Constants --- */
var API_BASE = 'https://api.torbox.app/v1/api';
var HISTORY_KEY = 'torbox_history';
var API_STATUS_KEY = 'torbox_api_status';
var MANIFEST_VERSION = '1.3.5';
var QUEUED_CHECK_ALARM = 'torbox-queued-check';
var QUEUED_CHECK_PERIOD_MINUTES = 0.5;
var queuedCheckInProgress = false;

/* --- Init --- */
browser.runtime.onInstalled.addListener(function () {
  browser.contextMenus.removeAll().then(function () {
    browser.contextMenus.create({
      id: 'send-to-torbox',
      title: 'Send to TorBox and start download',
      contexts: ['link'],
      targetUrlPatterns: [
        'magnet:*',
        '*://*/*.torrent*',
        'ftp://*/*.torrent*',
        'file:///*.torrent*'
      ]
    });
  });

  scheduleQueuedTorrentChecks();
  initKeyValidation();
});

browser.runtime.onStartup.addListener(function () {
  scheduleQueuedTorrentChecks();
  initKeyValidation();
});

browser.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== QUEUED_CHECK_ALARM) return;
  return checkQueuedTorrents().catch(function (err) {
    console.error('TorBox Magnet: queued torrent check failed', err);
  });
});

function scheduleQueuedTorrentChecks() {
  browser.alarms.create(QUEUED_CHECK_ALARM, {
    periodInMinutes: QUEUED_CHECK_PERIOD_MINUTES
  });
}

/* --- Session-level API key validation --- */
async function initKeyValidation() {
  var r = await browser.storage.local.get('torbox_api_key');
  if (r.torbox_api_key) {
    var s = await validateApiKey(r.torbox_api_key);
    await browser.storage.local.set({ [API_STATUS_KEY]: { valid: s.valid, email: s.email, error: s.error, checkedAt: Date.now() } });
  }
  checkForUpdate();
}

/* --- Periodic version check --- */
function semverGt(a, b) {
  var aa = a.split('.').map(Number);
  var bb = b.split('.').map(Number);
  for (var i = 0; i < 3; i++) {
    if ((aa[i] || 0) > (bb[i] || 0)) return true;
    if ((aa[i] || 0) < (bb[i] || 0)) return false;
  }
  return false;
}

async function checkForUpdate() {
  try {
    var res = await fetch('https://api.github.com/repos/silentdot/torbox-magnet-firefox-addon/releases/latest');
    if (!res.ok) return;
    var data = await res.json();
    var latestVer = (data.tag_name || '').replace(/^v/i, '');
    if (latestVer) {
      var isNewer = semverGt(latestVer, MANIFEST_VERSION);
      if (isNewer) {
        var dlUrl = data.assets && data.assets[0] && data.assets[0].browser_download_url;
        await browser.storage.local.set({
          update_cache: { current: MANIFEST_VERSION, latest: latestVer, url: dlUrl || data.html_url, checkedAt: Date.now() }
        });
      } else {
        // Clear the banner when up to date
        await browser.storage.local.set({ update_cache: { current: MANIFEST_VERSION, latest: null, url: null, checkedAt: Date.now() } });
      }
    }
  } catch (e) {}
}
// Check every 6 hours
setInterval(checkForUpdate, 21600000);

/* --- Helpers for URL matching --- */
function isMagnetUrl(url) {
  return typeof url === 'string' && /^magnet:/i.test(url);
}

function isTorrentUrl(url) {
  return typeof url === 'string' && !isMagnetUrl(url) && /\.torrent($|[?#&])/i.test(url);
}

/* --- Core: send to TorBox, returns {torrentId, name, hash}. --- */
async function sendToTorbox(url, apiKey) {
  var hash = '';
  var name = '';

  if (isMagnetUrl(url)) {
    hash = extractHash(url);
    name = extractNameFromMagnet(url) || 'Unknown';
  } else {
    name = extractFilename(url).replace(/\.torrent$/i, '') || 'Unknown';
  }

  var formData = new FormData();
  formData.append('allow_zip', 'true');

  if (isMagnetUrl(url)) {
    formData.append('magnet', url);
  } else {
    var fileRes = await fetch(url);
    if (!fileRes.ok) throw new Error('Failed to fetch .torrent (HTTP ' + fileRes.status + ')');
    var blob = await fileRes.blob();
    formData.append('file', blob, extractFilename(url) || 'torrent.torrent');
  }

  var res = await fetch(API_BASE + '/torrents/createtorrent', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    body: formData
  });
  var data;
  try {
    data = await res.json() || {};
  } catch (e) {
    data = {};
  }

  if (!res.ok || data.success === false) {
    var existing = hash ? await findExistingTorrent(hash, apiKey) : null;
    if (existing) return existing;
    throw new Error(data.detail || data.error || 'TorBox could not add the torrent (HTTP ' + res.status + ').');
  }

  var torrentId = data.data && (data.data.torrent_id || data.data.id);
  if (!torrentId) throw new Error('TorBox did not return a torrent ID.');
  if (data.data && data.data.name) name = data.data.name;
  if (data.data && data.data.hash) hash = data.data.hash;
  return { torrentId: torrentId, name: name, hash: hash };
}

async function findExistingTorrent(hash, apiKey) {
  try {
    var res = await fetch(API_BASE + '/torrents/mylist?bypass_cache=true&limit=1000', {
      headers: { 'Authorization': 'Bearer ' + apiKey }
    });
    if (!res.ok) return null;
    var data = await res.json();
    var entries = data && data.data;
    if (!Array.isArray(entries)) entries = entries ? [entries] : [];
    for (var i = 0; i < entries.length; i++) {
      if (String(entries[i].hash || '').toLowerCase() !== hash.toLowerCase()) continue;
      var torrentId = entries[i].torrent_id || entries[i].id;
      if (!torrentId) return null;
      return {
        torrentId: torrentId,
        name: entries[i].name || 'Unknown',
        hash: entries[i].hash || hash
      };
    }
  } catch (e) {}
  return null;
}

/* --- Build a direct TorBox download link --- */
function buildDownloadLink(torrentId, apiKey, zipWrap) {
  if (!torrentId || !apiKey) return '';
  var params = 'token=' + encodeURIComponent(apiKey) +
    '&torrent_id=' + encodeURIComponent(torrentId) +
    '&zip_link=' + (zipWrap ? 'true' : 'false') +
    '&redirect=true&append_name=true';
  return API_BASE + '/torrents/requestdl?' + params;
}

/* --- Context Menu Handler --- */
browser.contextMenus.onClicked.addListener(async function (info) {
  if (info.menuItemId !== 'send-to-torbox') return;

  var url = info.linkUrl;
  if (!isMagnetUrl(url) && !isTorrentUrl(url)) return;

  var r = await browser.storage.local.get('torbox_api_key');
  if (!r.torbox_api_key) {
    notify('API Key Required', 'Open the TorBox Magnet popup and paste your API key first.');
    return;
  }
  var apiKey = r.torbox_api_key;

  try {
    notify('TorBox', 'Processing...');

    var result = await sendToTorbox(url, apiKey);
    var rId = result.torrentId, rName = result.name, rHash = result.hash;

    if (rHash) {
      var cachedInfo = await checkCache(rHash, apiKey);
      if (cachedInfo.cached) {
        var needsZip = needsZipWrap(cachedInfo.files, rName);
        await startDownload(rId, apiKey, rName, url, rHash, needsZip);
        return;
      }
    }

    await addHistory({ magnet: url, name: rName, torrentId: rId, hash: rHash, cached: false, fileType: 'other' });
    scheduleQueuedTorrentChecks();
    notify('Added to TorBox', '"' + rName + '" has been added and queued.');

  } catch (err) {
    console.error('TorBox Magnet error:', err);
    notify('Error', err.message || 'Failed to send to TorBox.');
  }
});

/* --- Check Cache --- */
async function checkCache(hash, apiKey) {
  var hashUpper = hash.toUpperCase();
  try {
    var res = await fetch(API_BASE + '/torrents/checkcached?hash=' + encodeURIComponent(hashUpper) + '&list_files=true&format=object', {
      headers: {
        'Authorization': 'Bearer ' + apiKey
      }
    });
    if (!res.ok) return { cached: false, files: [] };
    var data = await res.json();
    var info = data.data && (data.data[hashUpper] || data.data[hash] || data.data[hash.toLowerCase()]);
    if (!info && Array.isArray(data.data)) {
      for (var i = 0; i < data.data.length; i++) {
        if (String(data.data[i].hash || '').toUpperCase() === hashUpper) {
          info = data.data[i];
          break;
        }
      }
    }
    if (!info) return { cached: false, files: [] };
    var files = [];
    if (Array.isArray(info.files)) {
      for (var i = 0; i < info.files.length; i++) {
        files.push(typeof info.files[i] === 'string' ? info.files[i] : (info.files[i].name || ''));
      }
    }
    return { cached: info.cached !== false, files: files };
  } catch (e) {
    return { cached: false, files: [] };
  }
}

/* --- Start a direct browser download for a cached torrent --- */
async function startDownload(torrentId, apiKey, name, url, hash, zipWrap, openInTab) {
  var dlUrl = buildDownloadLink(torrentId, apiKey, zipWrap);
  if (!dlUrl) throw new Error('No direct download link available.');

  if (openInTab) {
    await browser.tabs.create({ url: dlUrl });
  } else {
    var ext = zipWrap ? '.zip' : '';
    var filename = sanitiseFilename(name) + ext;
    var downloadOptions = { url: dlUrl };
    if (filename) downloadOptions.filename = filename;
    await browser.downloads.download(downloadOptions);
  }

  await addHistory({ magnet: url, hash: hash, name: name, torrentId: torrentId, cached: true, zipWrap: zipWrap, fileType: 'other' });
  notify('Download Starting', (zipWrap ? 'ZIP ' : '') + 'Download started for "' + name + '".');
}

/* --- History --- */
async function getHistory() {
  var r = await browser.storage.local.get(HISTORY_KEY);
  return r[HISTORY_KEY] || [];
}

async function addHistory(entry) {
  var h = await getHistory();
  entry.id = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
  entry.timestamp = Date.now();
  h.unshift(entry);
  if (h.length > 200) h.length = 200;
  await browser.storage.local.set({ [HISTORY_KEY]: h });
}

async function checkQueuedTorrents(apiKey) {
  if (queuedCheckInProgress) return getHistory();
  queuedCheckInProgress = true;

  try {
    if (!apiKey) {
      var stored = await browser.storage.local.get('torbox_api_key');
      apiKey = stored.torbox_api_key;
    }
    if (!apiKey) return [];

    var history = await getHistory();
    var changed = false;
    var notifiedHashes = {};
    var readyNames = [];

    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      if (entry.cached || !entry.hash) continue;

      var cachedInfo = await checkCache(entry.hash, apiKey);
      if (!cachedInfo.cached) continue;

      var hashKey = String(entry.hash).toLowerCase();
      var shouldNotify = !entry.readyNotified && !notifiedHashes[hashKey];
      entry.cached = true;
      entry.zipWrap = needsZipWrap(cachedInfo.files, entry.name);
      entry.readyNotified = true;
      changed = true;

      if (shouldNotify) {
        notifiedHashes[hashKey] = true;
        readyNames.push(entry.name || 'Torrent');
      }
    }

    if (changed) await browser.storage.local.set({ [HISTORY_KEY]: history });
    for (var ri = 0; ri < readyNames.length; ri++) {
      notify('Download Ready', '"' + readyNames[ri] + '" is ready to download. Open the TorBox popup to start it.');
    }
    return history;
  } finally {
    queuedCheckInProgress = false;
  }
}

async function clearHistory() {
  await browser.storage.local.set({ [HISTORY_KEY]: [] });
}

async function removeHistoryEntry(hash, id) {
  var h = await getHistory();
  await browser.storage.local.set({
    [HISTORY_KEY]: h.filter(function (e) { return id ? e.id !== id : e.hash !== hash; })
  });
}

/* --- API Key Validation --- */
async function validateApiKey(apiKey) {
  try {
    var res = await fetch(API_BASE + '/user/me', {
      headers: { 'Authorization': 'Bearer ' + apiKey }
    });
    var data = await res.json();
    if (!res.ok || data.success === false) {
      return { valid: false, error: data.detail || data.error || 'HTTP ' + res.status };
    }
    var user = data.data || data;
    return { valid: true, email: user.email || user.username || 'Connected' };
  } catch (e) {
    return { valid: false, error: e.message || 'Connection failed' };
  }
}

/* --- Message Handling (for popup) --- */
browser.runtime.onMessage.addListener(function (msg, sender) {
  return handleMessage(msg).catch(function (err) {
    console.error('TorBox Magnet: message handler error', err);
    return { error: err.message };
  });
});

async function handleMessage(msg) {
  switch (msg.type) {

    case 'get-history':
      return { history: await getHistory() };

    case 'clear-history':
      await clearHistory();
      return { ok: true };

    case 'delete-history-entry':
      await removeHistoryEntry(msg.hash, msg.id);
      return { ok: true };

    case 'refresh-history-cache': {
      var r2 = await browser.storage.local.get('torbox_api_key');
      if (!r2.torbox_api_key) return { ok: false, error: 'No API key' };
      return { history: await checkQueuedTorrents(r2.torbox_api_key) };
    }

    case 'get-apikey-status': {
      var s = await browser.storage.local.get(API_STATUS_KEY);
      return s[API_STATUS_KEY] || { valid: false, error: 'Not checked' };
    }

    case 'validate-apikey': {
      var result = await validateApiKey(msg.apiKey);
      var s = {};
      s[API_STATUS_KEY] = { valid: result.valid, email: result.email, error: result.error, checkedAt: Date.now() };
      await browser.storage.local.set(s);
      return result;
    }

    case 're-download': {
      var r = await browser.storage.local.get('torbox_api_key');
      if (!r.torbox_api_key) return { ok: false, error: 'No API key' };
      await startDownload(msg.torrentId, r.torbox_api_key, msg.name, '', '', msg.zipWrap !== false, true);
      return { ok: true };
    }

    case 'open-dashboard':
      browser.tabs.create({ url: 'https://torbox.app/dashboard' });
      return { ok: true };

    case 'open-update':
      if (msg.url) browser.tabs.create({ url: msg.url, active: true });
      return { ok: true };

    case 'check-update-now':
      await checkForUpdate();
      var r2 = await browser.storage.local.get('update_cache');
      return r2.update_cache || { current: '', latest: null, url: null };

    case 'check-update': {
      var r = await browser.storage.local.get('update_cache');
      return r.update_cache || { current: '', latest: null, url: null };
    }

    default:
      return { error: 'Unknown message type: ' + msg.type };
  }
}

/* --- File Type Detection --- */
var FILE_TYPE_MAP = [
  { type: 'archive', exts: ['.zip','.rar','.7z','.tar','.tgz','.tar.gz','.tzst','.tar.zst','.tbz2','.tar.bz2','.txz','.tar.xz','.gz','.bz2','.xz','.zst','.lz','.lzma','.lzo','.cab'] },
  { type: 'video',   exts: ['.mkv','.mp4','.avi','.mov','.wmv','.flv','.webm','.m4v','.mpg','.mpeg','.ts','.vob','.m2ts'] },
  { type: 'audio',   exts: ['.mp3','.flac','.wav','.aac','.ogg','.wma','.m4a','.opus','.ac3','.dts','.alac'] },
  { type: 'image',   exts: ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.svg','.tiff','.tif','.ico','.avif'] },
  { type: 'doc',     exts: ['.pdf','.epub','.mobi','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.txt','.csv','.md','.nfo'] },
  { type: 'app',     exts: ['.exe','.msi','.app','.dmg','.deb','.rpm','.apk','.AppImage','.run','.bin','.jar'] }
];

function detectFileType(files, name) {
  var candidates = [];
  if (files && files.length > 0) candidates = files;
  if (name && (candidates.length === 0 || name.indexOf('.') !== -1)) candidates.push(name);
  for (var ci = 0; ci < candidates.length; ci++) {
    var lower = candidates[ci].toLowerCase();
    for (var ti = 0; ti < FILE_TYPE_MAP.length; ti++) {
      var group = FILE_TYPE_MAP[ti];
      for (var ei = 0; ei < group.exts.length; ei++) {
        if (lower.lastIndexOf(group.exts[ei]) === lower.length - group.exts[ei].length) return group.type;
      }
    }
  }
  return 'other';
}

/* --- Archive Detection (zip-wrap logic) --- */
var ARCHIVE_EXTS = FILE_TYPE_MAP[0].exts;

function isArchiveFile(name) {
  if (!name) return false;
  var lower = name.toLowerCase();
  for (var i = 0; i < ARCHIVE_EXTS.length; i++) {
    if (lower.lastIndexOf(ARCHIVE_EXTS[i]) === lower.length - ARCHIVE_EXTS[i].length) return true;
  }
  return false;
}

function needsZipWrap(files, torrentName) {
  if (!files || files.length === 0) return !isArchiveFile(torrentName);
  if (files.length === 1) return !isArchiveFile(files[0]);
  return true;
}

/* --- Helpers --- */
function extractHash(magnet) {
  var m = magnet.match(/btih:([a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[A-Z2-7]{32})/);
  return m ? m[1].toLowerCase() : '';
}

function extractNameFromMagnet(magnet) {
  if (!magnet) return '';
  var m = magnet.match(/[?&]dn=([^&]+)/);
  if (!m) return '';
  try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); }
  catch (e) { return ''; }
}

function extractFilename(url) {
  if (!url) return '';
  var u = url.split(/[?#]/)[0];
  var parts = u.split('/');
  var filename = parts[parts.length - 1] || '';
  try { return decodeURIComponent(filename); }
  catch (e) { return filename; }
}

function sanitiseFilename(s) {
  return s.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
}

function notify(title, message) {
  browser.notifications.create({
    type: 'basic',
    iconUrl: browser.runtime.getURL('icons/icon.svg'),
    title: 'TorBox \u2014 ' + title,
    message: message
  });
}
