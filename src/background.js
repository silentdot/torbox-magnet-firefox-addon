/**
 * TorBox Magnet — Background Script
 *
 * Supports magnet URIs and .torrent file URLs via a single context menu item.
 * Flow: right-click link -> add to TorBox -> check cache -> download ZIP if cached
 */

/* --- Constants --- */
var API_BASE = 'https://api.torbox.app/v1/api';
var HISTORY_KEY = 'torbox_history';
var API_STATUS_KEY = 'torbox_api_status';

/* --- Init --- */
browser.runtime.onInstalled.addListener(function () {
  browser.contextMenus.removeAll();

  // Single menu item for all torrent-related links (magnet + .torrent).
  // Shows on every link; the handler filters to only process magnet/.torrent URLs.
  browser.contextMenus.create({
    id: 'send-to-torbox',
    title: 'Send to TorBox',
    contexts: ['link']
  });

  // Copy magnet — only on magnet links
  browser.contextMenus.create({
    id: 'copy-magnet',
    title: 'Copy magnet link',
    contexts: ['link'],
    targetUrlPatterns: ['magnet:*']
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
}

/* --- Context Menu Handler --- */
browser.contextMenus.onClicked.addListener(async function (info) {
  // Copy magnet handler
  if (info.menuItemId === 'copy-magnet') {
    try {
      await browser.tabs.executeScript({
        code: 'navigator.clipboard.writeText(' + JSON.stringify(info.linkUrl) + ');'
      });
    } catch (e) {
      try {
        await browser.tabs.executeScript({
          code: '(function(){var ta=document.createElement("textarea");ta.value=' + JSON.stringify(info.linkUrl) + ';ta.style.position="fixed";ta.style.left="-9999px";document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();})();'
        });
      } catch (e2) {
        notify('Copy Failed', 'Could not copy the link.');
      }
    }
    return;
  }

  if (info.menuItemId !== 'send-to-torbox') return;

  var url = info.linkUrl;

  // Only process magnet URIs and URLs pointing to .torrent files.
  // Catches: file.torrent, file.torrent?query, file.torrent#hash
  var isMagnet = url.startsWith('magnet:');
  var isTorrent = !isMagnet && url.match(/\.torrent($|[?#&])/i);
  if (!isMagnet && !isTorrent) return;

  var r = await browser.storage.local.get('torbox_api_key');
  if (!r.torbox_api_key) {
    notify('API Key Required', 'Open the TorBox Magnet popup and paste your API key first.');
    return;
  }
  var apiKey = r.torbox_api_key;

  try {
    notify('TorBox', 'Sending\u2026');

    var formData = new FormData();
    formData.append('allow_zip', 'true');
    var hash = '';
    var name = '';

    if (isMagnet) {
      formData.append('magnet', url);
      hash = extractHash(url);
      name = extractNameFromMagnet(url) || 'Unknown';
    } else {
      // Fetch the .torrent file and submit it
      var fileRes = await fetch(url);
      if (!fileRes.ok) throw new Error('Failed to fetch .torrent (HTTP ' + fileRes.status + ')');
      var blob = await fileRes.blob();
      formData.append('file', blob, extractFilename(url) || 'torrent.torrent');
      name = extractFilename(url).replace(/\.torrent($|[?#&])/i, '') || 'Unknown';
    }

    var createRes = await fetch(API_BASE + '/torrents/createtorrent', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      body: formData
    });

    var createData = await createRes.json();
    if (!createRes.ok || createData.success === false) {
      throw new Error(createData.detail || createData.error || 'HTTP ' + createRes.status);
    }

    var torrentId = createData.data && (createData.data.torrent_id || createData.data.id);
    if (createData.data && createData.data.name) name = createData.data.name;
    if (!hash && createData.data && createData.data.hash) hash = createData.data.hash;

    if (hash) {
      var cachedInfo = await checkCache(hash, apiKey);
      if (cachedInfo.cached && torrentId) {
        var needsZip = needsZipWrap(cachedInfo.files, name);
        await downloadCachedZip(torrentId, apiKey, name, url, hash, needsZip);
        return;
      }
    }

    await addHistory({ magnet: url, hash: hash, name: name, torrentId: torrentId, cached: false, fileType: 'other' });
    notify('Added to TorBox', '"' + (name !== 'Unknown' ? name : 'Torrent') + '" has been added and queued.');

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
    console.warn('TorBox Magnet: cache check failed', e);
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
      var url2 = body && body.data && body.data.url;
      if (url2) browser.downloads.download({ url: url2, filename: filename });
      else browser.tabs.create({ url: dlUrl });
    } catch (e) {
      browser.tabs.create({ url: dlUrl });
    }
  }

  await addHistory({ magnet: url, hash: hash, name: name, torrentId: torrentId, cached: true });
  var msg = zipWrap ? 'ZIP download started for "' + name + '".' : 'Download started for "' + name + '".';
  notify('Download Starting', msg);
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
    case 'open-dashboard':
      browser.tabs.create({ url: 'https://torbox.app/dashboard' });
      return { ok: true };
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
