/**
 * TorBox Magnet — Background Script
 *
 * Flow: right-click magnet → add to TorBox → check cache → download ZIP if cached
 * Also manages download history and API key validation.
 */

/* ─── Constants ─── */
const API_BASE = 'https://api.torbox.app/v1/api';
const HISTORY_KEY = 'torbox_history';

/* ─── Init ─── */
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: 'send-magnet-to-torbox',
    title: 'Send magnet to TorBox',
    contexts: ['link'],
    targetUrlPatterns: ['magnet:*']
  });
  browser.contextMenus.create({
    id: 'copy-magnet-to-clipboard',
    title: 'Copy magnet link',
    contexts: ['link'],
    targetUrlPatterns: ['magnet:*']
  });
});

/* ─── Context Menu Handlers ─── */
browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'copy-magnet-to-clipboard') {
    // Use a content script in the active tab to copy to clipboard
    // (background pages can't access clipboard directly in all browsers)
    try {
      await browser.tabs.executeScript({
        code: `navigator.clipboard.writeText(${JSON.stringify(info.linkUrl)});`
      });
      // Fallback: if the tab doesn't have clipboard access, show notification
    } catch {
      // Final fallback: use a temp textarea injected into the page
      try {
        await browser.tabs.executeScript({
          code: `
            (() => {
              const ta = document.createElement('textarea');
              ta.value = ${JSON.stringify(info.linkUrl)};
              ta.style.position = 'fixed'; ta.style.left = '-9999px';
              document.body.appendChild(ta);
              ta.select(); document.execCommand('copy');
              ta.remove();
            })();
          `
        });
      } catch {
        notify('Copy Failed', 'Could not copy the magnet link.');
        return;
      }
    }
    return;
  }

  if (info.menuItemId !== 'send-magnet-to-torbox') return;

  const { torbox_api_key } = await browser.storage.local.get('torbox_api_key');
  if (!torbox_api_key) {
    notify('API Key Required', 'Open the TorBox Magnet popup and paste your API key first.');
    return;
  }

  const magnet = info.linkUrl;
  const hash = extractHash(magnet);

  try {
    notify('TorBox', 'Adding magnet to TorBox\u2026');

    /* ── Step 1: Submit magnet (multipart/form-data) ── */
    const formData = new FormData();
    formData.append('magnet', magnet);
    formData.append('allow_zip', 'true');

    const createRes = await fetch(`${API_BASE}/torrents/createtorrent`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${torbox_api_key}` },
      body: formData
    });

    const createData = await createRes.json();
    if (!createRes.ok || createData.success === false) {
      throw new Error(createData.detail || createData.error || `HTTP ${createRes.status}`);
    }

    const torrentId = createData.data?.torrent_id ?? createData.data?.id;
    const torrentName = createData.data?.name ?? 'Unknown';

    /* ── Step 2: Check cache + determine if zip-wrapping is needed ── */
    let cachedInfo = { cached: false, files: [] };
    if (hash) {
      cachedInfo = await checkCache(hash, torbox_api_key);
    }

    if (cachedInfo.cached && torrentId) {
      const needsZip = needsZipWrap(cachedInfo.files, torrentName);
      await downloadCachedZip(torrentId, torbox_api_key, torrentName, magnet, hash, needsZip);
    } else {
      // Save as queued in history
      await addHistory({ magnet, hash, name: torrentName, torrentId, cached: false });
      const label = torrentName !== 'Unknown' ? `"${torrentName}"` : 'Torrent';
      notify(
        'Added to TorBox',
        `${label} has been added. It's being downloaded to TorBox servers — you can download it from your dashboard once ready.`
      );
    }
  } catch (err) {
    console.error('TorBox Magnet error:', err);
    notify('Error', err.message || 'Failed to send magnet to TorBox.');
  }
});

/* ─── Check Cache ─── */
async function checkCache(hash, apiKey) {
  const hashUpper = hash.toUpperCase();
  try {
    // Request file list so we can detect archive-only torrents
    const res = await fetch(
      `${API_BASE}/torrents/checkcached?list_files=true&format=object`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ hashes: [hashUpper] })
      }
    );
    const data = await res.json();
    const info = data.data?.[hashUpper] ??
                 data.data?.[hash] ??
                 data.data?.[hash.toLowerCase()];
    if (!info) return { cached: false, files: [] };

    // Extract filenames from the response (structure varies)
    const files = Array.isArray(info.files)
      ? info.files.map(f => typeof f === 'string' ? f : (f.name || ''))
      : [];

    return { cached: true, files };
  } catch (e) {
    console.warn('TorBox Magnet: cache check failed', e);
    return { cached: false, files: [] };
  }
}

/* ─── Download Cached Torrent ─── */
async function downloadCachedZip(torrentId, apiKey, name, magnet, hash, zipWrap) {
  // zipWrap: true  → torrent gets bundled into a .zip (default for multi-file)
  //         false → torrent is already a single archive, download as-is
  const params = new URLSearchParams({
    token: apiKey,
    torrent_id: String(torrentId),
    zip_link: zipWrap ? 'true' : 'false',
    redirect: 'true',
    append_name: 'true'
  });
  const dlUrl = `${API_BASE}/torrents/requestdl?${params}`;

  const dlRes = await fetch(dlUrl, { redirect: 'manual' });

  // Choose the right filename extension
  const ext = zipWrap ? '.zip' : '';  // no forced extension—TorBox returns original
  const filename = ext ? `${sanitiseFilename(name)}${ext}` : undefined;

  if (dlRes.type === 'opaqueredirect') {
    browser.tabs.create({ url: dlUrl });
  } else if (dlRes.status >= 300 && dlRes.status < 400) {
    const location = dlRes.headers.get('Location');
    if (location) {
      browser.downloads.download({ url: location, filename });
    } else {
      browser.tabs.create({ url: dlUrl });
    }
  } else {
    try {
      const body = await dlRes.json();
      const url = body?.data?.url;
      if (url) {
        browser.downloads.download({ url, filename });
      } else {
        browser.tabs.create({ url: dlUrl });
      }
    } catch {
      browser.tabs.create({ url: dlUrl });
    }
  }

  // Save to history
  await addHistory({ magnet, hash, name, torrentId, cached: true });

  const msg = zipWrap
    ? `ZIP download started for "${name}".`
    : `Download started for "${name}".`;
  notify('Download Starting', msg);
}

/* ─── History ─── */

async function getHistory() {
  const { [HISTORY_KEY]: history } = await browser.storage.local.get(HISTORY_KEY);
  return history || [];
}

async function addHistory(entry) {
  const history = await getHistory();
  history.unshift({
    ...entry,
    timestamp: Date.now()
  });
  // Keep max 200 entries
  if (history.length > 200) history.length = 200;
  await browser.storage.local.set({ [HISTORY_KEY]: history });
}

async function clearHistory() {
  await browser.storage.local.set({ [HISTORY_KEY]: [] });
}

async function removeHistoryEntry(hash) {
  const history = await getHistory();
  await browser.storage.local.set({
    [HISTORY_KEY]: history.filter(e => e.hash !== hash)
  });
}

/* ─── API Key Validation ─── */
async function validateApiKey(apiKey) {
  try {
    const res = await fetch(`${API_BASE}/user/me`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      return { valid: false, error: data.detail || data.error || `HTTP ${res.status}` };
    }
    const user = data.data || data;
    return { valid: true, email: user.email || user.username || 'Connected' };
  } catch (e) {
    return { valid: false, error: e.message || 'Connection failed' };
  }
}

/* ─── Message Handling (for popup) ─── */
browser.runtime.onMessage.addListener((msg, sender) => {
  return handleMessage(msg).catch(err => {
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

    case 'validate-apikey':
      return await validateApiKey(msg.apiKey);

    case 're-download': {
      // Re-download a torrent by its ID
      const { torbox_api_key } = await browser.storage.local.get('torbox_api_key');
      if (!torbox_api_key) return { ok: false, error: 'No API key' };
      // Re-downloads use zip-wrap to be safe (we don't cache the file list in history)
      await downloadCachedZip(msg.torrentId, torbox_api_key, msg.name, '', '', true);
      return { ok: true };
    }

    case 'open-dashboard':
      browser.tabs.create({ url: 'https://torbox.app/dashboard' });
      return { ok: true };

    default:
      return { error: 'Unknown message type: ' + msg.type };
  }
}

/* ─── Archive Detection ─── */

// Common archive/compressed file extensions that don't need zip-wrapping
const ARCHIVE_EXTS = new Set([
  '.zip', '.rar', '.7z', '.tar',
  '.tgz', '.tar.gz', '.tzst', '.tar.zst',
  '.tbz2', '.tar.bz2', '.txz', '.tar.xz',
  '.gz', '.bz2', '.xz', '.zst', '.lz', '.lzma', '.lzo',
  '.iso', '.cab', '.dmg', '.deb', '.rpm', '.apk'
]);

/** Check if a filename has a common archive extension */
function isArchiveFile(name) {
  if (!name) return false;
  // Check the full extension first, then try known compound extensions
  const lower = name.toLowerCase();
  for (const ext of ARCHIVE_EXTS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Decide whether the download needs zip-wrapping.
 * Returns false (no zip) when the torrent is a single archive file —
 * avoids turning a .rar into a .rar.zip.
 */
function needsZipWrap(files, torrentName) {
  // No file list from API — zip-wrap to be safe (multi-file torrent)
  if (!files || files.length === 0) {
    // If the torrent name itself looks like an archive, skip zip
    return !isArchiveFile(torrentName);
  }
  // Single file: skip zip if it's already an archive
  if (files.length === 1) {
    return !isArchiveFile(files[0]);
  }
  // Multiple files: always zip-wrap
  return true;
}

/* ─── Helpers ─── */

function extractHash(magnet) {
  const m = magnet.match(/btih:([a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[A-Z2-7]{32})/);
  return m ? m[1].toLowerCase() : '';
}

function sanitiseFilename(s) {
  return s.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
}

function notify(title, message) {
  browser.notifications.create({
    type: 'basic',
    iconUrl: browser.runtime.getURL('icons/icon.svg'),
    title: `TorBox — ${title}`,
    message
  });
}
