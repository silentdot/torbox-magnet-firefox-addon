/**
 * TorBox Magnet — Background Script
 *
 * Supports magnet URIs and .torrent file URLs.
 * Two context menu modes: download immediately, or copy TorBox share link.
 */

/* --- Constants --- */
var API_BASE = 'https://api.torbox.app/v1/api';
var HISTORY_KEY = 'torbox_history';
var API_STATUS_KEY = 'torbox_api_status';
var MANIFEST_VERSION = '1.2.4';

/* --- Init --- */
browser.runtime.onInstalled.addListener(function () {
  browser.contextMenus.removeAll();

  browser.contextMenus.create({
    id: 'send-dl',
    title: 'Send to TorBox and start download',
    contexts: ['link']
  });

  browser.contextMenus.create({
    id: 'send-share',
    title: 'Send to TorBox and copy share link',
    contexts: ['link']
  });

  initKeyValidation();
});

browser.runtime.onStartup.addListener(function () { initKeyValidation(); });

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
function isMagnetUrl(url) { return url.startsWith('magnet:'); }
function isTorrentUrl(url) { return !isMagnetUrl(url) && url.match(/\.torrent($|[?#&])/i); }

/* --- Core: send to TorBox, returns {torrentId, name, hash}.
     If the torrent already exists on TorBox, createtorrent may error.
     In that case we still return the info we can extract from the URL. --- */
async function sendToTorbox(url, apiKey) {
  var hash = '';
  var name = '';

  if (isMagnetUrl(url)) {
    hash = extractHash(url);
    name = extractNameFromMagnet(url) || 'Unknown';
  } else {
    name = extractFilename(url).replace(/\.torrent($|[?#&])/i, '') || 'Unknown';
  }

  try {
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
    var data = await res.json();

    if (res.ok && data.success !== false) {
      var torrentId = data.data && (data.data.torrent_id || data.data.id);
      if (data.data && data.data.name) name = data.data.name;
      if (data.data && data.data.hash) hash = data.data.hash;
      return { torrentId: torrentId, name: name, hash: hash };
    }
  } catch (e) {
    // createtorrent failed — torrent likely already exists
    console.warn('TorBox Magnet: createtorrent failed (may already exist)', e.message);
  }

  // Return what we extracted from the URL even if the API call failed
  return { torrentId: null, name: name, hash: hash };
}

/* --- Build TorBox share link --- */
function buildShareLink(torrentId, hash) {
  if (hash) return 'https://torbox.app/torrent/' + hash.toLowerCase();
  if (torrentId) return 'https://torbox.app/torrent/' + torrentId;
  return '';
}

/* --- Copy text to clipboard from background --- */
async function copyToClipboard(text) {
  try {
    await browser.tabs.executeScript({
      code: 'navigator.clipboard.writeText(' + JSON.stringify(text) + ');'
    });
  } catch (e) {
    try {
      await browser.tabs.executeScript({
        code: '(function(){var ta=document.createElement("textarea");ta.value=' + JSON.stringify(text) + ';ta.style.position="fixed";ta.style.left="-9999px";document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();})();'
      });
    } catch (e2) {
      throw new Error('Clipboard write failed');
    }
  }
}

/* --- Context Menu Handler --- */
browser.contextMenus.onClicked.addListener(async function (info) {
  if (info.menuItemId !== 'send-dl' && info.menuItemId !== 'send-share') return;

  var url = info.linkUrl;
  if (!isMagnetUrl(url) && !isTorrentUrl(url)) return;

  // History entry builder
  function saveHistory(cached, extra) {
    var entry = { magnet: url, name: rName, torrentId: rId, hash: rHash, cached: cached, fileType: 'other' };
    if (extra) for (var k in extra) entry[k] = extra[k];
    addHistory(entry);
  }

  var r = await browser.storage.local.get('torbox_api_key');
  if (!r.torbox_api_key) {
    notify('API Key Required', 'Open the TorBox Magnet popup and paste your API key first.');
    return;
  }
  var apiKey = r.torbox_api_key;

  try {
    notify('TorBox', 'Processing\u2026');

    var result = await sendToTorbox(url, apiKey);
    var rId = result.torrentId, rName = result.name, rHash = result.hash;

    if (info.menuItemId === 'send-share') {
      // Build the TorBox share link and copy it.
      // rHash is always populated for magnets (extracted from URL).
      // For .torrent files, it depends on the API response.
      var shareLink = buildShareLink(rId, rHash);
      if (!shareLink && isMagnetUrl(url) && rHash) {
        shareLink = 'https://torbox.app/torrent/' + rHash;
      }
      if (!shareLink) {
        notify('Share Link', 'Torrent added. Open dashboard to find the share link.');
        return;
      }
      try {
        await copyToClipboard(shareLink);
        if (rHash) await addHistory({ magnet: url, hash: rHash, name: rName, torrentId: rId, cached: false, fileType: 'other' });
        notify('Share Link Copied', shareLink);
      } catch (e) {
        notify('Share Link', shareLink);
      }
      return;
    }

    // send-dl: download if cached, queue otherwise
    if (rHash) {
      var cachedInfo = await checkCache(rHash, apiKey);
      if (cachedInfo.cached && rId) {
        var needsZip = needsZipWrap(cachedInfo.files, rName);
        await downloadCachedZip(rId, apiKey, rName, url, rHash, needsZip);
        return;
      }
    }

    saveHistory(false);
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
    var res = await fetch(API_BASE + '/torrents/checkcached?list_files=true&format=object', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ hashes: [hashUpper] })
    });
    var data = await res.json();
    var info = data.data && (
      data.data[hashUpper] || data.data[hash] || data.data[hash.toLowerCase()]
    );
    if (!info) return { cached: false, files: [] };
    var files = [];
    if (Array.isArray(info.files)) {
      for (var i = 0; i < info.files.length; i++) {
        files.push(typeof info.files[i] === 'string' ? info.files[i] : (info.files[i].name || ''));
      }
    }
    return { cached: true, files: files };
  } catch (e) {
    return { cached: false, files: [] };
  }
}

/* --- Download Cached Torrent --- */
async function downloadCachedZip(torrentId, apiKey, name, url, hash, zipWrap) {
  var params = 'token=' + encodeURIComponent(apiKey) +
    '&torrent_id=' + encodeURIComponent(torrentId) +
    '&zip_link=' + (zipWrap ? 'true' : 'false') +
    '&redirect=true&append_name=true';
  var dlUrl = API_BASE + '/torrents/requestdl?' + params;
  var dlRes = await fetch(dlUrl, { redirect: 'manual' });

  var ext = zipWrap ? '.zip' : '';
  var filename = ext ? sanitiseFilename(name) + ext : undefined;

  if (dlRes.type === 'opaqueredirect') {
    browser.tabs.create({ url: dlUrl });
  } else if (dlRes.status >= 300 && dlRes.status < 400) {
    var location = dlRes.headers.get('Location');
    if (location) browser.downloads.download({ url: location, filename: filename });
    else browser.tabs.create({ url: dlUrl });
  } else {
    try {
      var body = await dlRes.json();
      var downloadUrl = body && body.data && body.data.url;
      if (downloadUrl) browser.downloads.download({ url: downloadUrl, filename: filename });
      else browser.tabs.create({ url: dlUrl });
    } catch (e) {
      browser.tabs.create({ url: dlUrl });
    }
  }

  await addHistory({ magnet: url, hash: hash, name: name, torrentId: torrentId, cached: true, fileType: 'other' });
  notify('Download Starting', (zipWrap ? 'ZIP ' : '') + 'Download started for "' + name + '".');
}

/* --- History --- */
async function getHistory() {
  var r = await browser.storage.local.get(HISTORY_KEY);
  return r[HISTORY_KEY] || [];
}

async function addHistory(entry) {
  var h = await getHistory();
  entry.timestamp = Date.now();
  h.unshift(entry);
  if (h.length > 200) h.length = 200;
  await browser.storage.local.set({ [HISTORY_KEY]: h });
}

async function clearHistory() {
  await browser.storage.local.set({ [HISTORY_KEY]: [] });
}

async function removeHistoryEntry(hash) {
  var h = await getHistory();
  await browser.storage.local.set({ [HISTORY_KEY]: h.filter(function (e) { return e.hash !== hash; }) });
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
      await removeHistoryEntry(msg.hash);
      return { ok: true };

    case 'refresh-history-cache': {
      var history = await getHistory();
      var r2 = await browser.storage.local.get('torbox_api_key');
      if (!r2.torbox_api_key) return { ok: false, error: 'No API key' };
      for (var i = 0; i < history.length; i++) {
        if (!history[i].cached && history[i].hash) {
          var ci = await checkCache(history[i].hash, r2.torbox_api_key);
          if (ci.cached) history[i].cached = true;
        }
      }
      await browser.storage.local.set({ [HISTORY_KEY]: history });
      return { history: history };
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
      await downloadCachedZip(msg.torrentId, r.torbox_api_key, msg.name, '', '', true);
      return { ok: true };
    }

    case 'copy-share-link': {
      var link = buildShareLink(msg.torrentId, msg.hash);
      if (!link) return { ok: false, error: 'No share link available' };
      try { await copyToClipboard(link); return { ok: true, link: link }; }
      catch (e) { return { ok: false, error: e.message }; }
    }

    case 'send-page-magnets': {
      // Process multiple URLs: send + download cached ones
      var r = await browser.storage.local.get('torbox_api_key');
      if (!r.torbox_api_key) return { ok: false, error: 'No API key' };
      var apiKey = r.torbox_api_key;
      var results = [];
      for (var i = 0; i < msg.urls.length; i++) {
        var url = msg.urls[i];
        try {
          var result = await sendToTorbox(url, apiKey);
          var cached = false;
          if (result.hash) {
            var ci = await checkCache(result.hash, apiKey);
            cached = ci.cached;
            if (cached && result.torrentId) {
              var nz = needsZipWrap(ci.files, result.name);
              await downloadCachedZip(result.torrentId, apiKey, result.name, url, result.hash, nz);
              results.push({ url: url, status: 'downloaded', name: result.name });
              continue;
            }
          }
          await addHistory({ magnet: url, hash: result.hash, name: result.name, torrentId: result.torrentId, cached: false, fileType: 'other' });
          results.push({ url: url, status: 'queued', name: result.name });
        } catch (err) {
          results.push({ url: url, status: 'error', error: err.message });
        }
      }
      return { ok: true, results: results };
    }

    case 'open-dashboard':
      browser.tabs.create({ url: 'https://torbox.app/dashboard' });
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
  var u = url.split('?')[0];
  var parts = u.split('/');
  return parts[parts.length - 1] || '';
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
