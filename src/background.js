/**
 * TorBox Magnet — Background Script
 *
 * Flow: right-click magnet → add to TorBox → check cache → download ZIP if cached
 */

/* ─── Constants ─── */
const API_BASE = 'https://api.torbox.app/v1/api';

/* ─── Init ─── */
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: 'send-magnet-to-torbox',
    title: 'Send magnet to TorBox',
    contexts: ['link'],
    targetUrlPatterns: ['magnet:*']
  });
});

/* ─── Handle click ─── */
browser.contextMenus.onClicked.addListener(async (info) => {
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

    /* ── Step 1: Submit magnet (multipart/form-data, not JSON) ── */
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

    /* ── Step 2: Check if cached — POST with JSON body (query-array unreliable) ── */
    if (hash) {
      const hashUpper = hash.toUpperCase();
      const cachedRes = await fetch(`${API_BASE}/torrents/checkcached`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${torbox_api_key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ hashes: [hashUpper] })
      });

      let isCached = false;
      try {
        const cachedData = await cachedRes.json();
        // TorBox keys hashes in uppercase; check all cases to be safe
        const info = cachedData.data?.[hashUpper] ??
                     cachedData.data?.[hash] ??
                     cachedData.data?.[hash.toLowerCase()];
        isCached = !!info;
      } catch (parseErr) {
        console.warn('TorBox Magnet: cache check parse failed', parseErr);
      }

      if (isCached && torrentId) {
        await downloadCachedZip(torrentId, torbox_api_key, torrentName);
        return;
      }
    }

    /* ── Step 3b: Not cached — queued for download ── */
    const label = torrentName !== 'Unknown' ? `"${torrentName}"` : 'Torrent';
    notify(
      'Added to TorBox',
      `${label} has been added. It's being downloaded to TorBox servers — you can download it from your dashboard once ready.`
    );

  } catch (err) {
    console.error('TorBox Magnet error:', err);
    notify('Error', err.message || 'Failed to send magnet to TorBox.');
  }
});

/* ─── Download cached torrent as ZIP ─── */
async function downloadCachedZip(torrentId, apiKey, name) {
  // requestdl authenticates via the token query param (the API key), not Bearer header
  const params = new URLSearchParams({
    token: apiKey,
    torrent_id: String(torrentId),
    zip_link: 'true',
    redirect: 'true',
    append_name: 'true'
  });
  const dlUrl = `${API_BASE}/torrents/requestdl?${params}`;

  // Fetch with manual redirect so we can capture the redirect URL
  const dlRes = await fetch(dlUrl, { redirect: 'manual' });

  if (dlRes.type === 'opaqueredirect') {
    // Can't follow redirect — open URL in a tab (browser handles the redirect)
    browser.tabs.create({ url: dlUrl });
  } else if (dlRes.status >= 300 && dlRes.status < 400) {
    const location = dlRes.headers.get('Location');
    if (location) {
      // Download directly via the Downloads API
      browser.downloads.download({ url: location, filename: `${sanitiseFilename(name)}.zip` });
    } else {
      browser.tabs.create({ url: dlUrl });
    }
  } else {
    // Response not a redirect — try parsing body for download URL
    try {
      const body = await dlRes.json();
      const url = body?.data?.url;
      if (url) {
        browser.downloads.download({ url, filename: `${sanitiseFilename(name)}.zip` });
      } else {
        // Open the permalink directly — it'll handle everything
        browser.tabs.create({ url: dlUrl });
      }
    } catch {
      browser.tabs.create({ url: dlUrl });
    }
  }

  notify('Download Starting', `ZIP download started for "${name}".`);
}

/* ─── Helpers ─── */

/** Extract the info-hash from a magnet URI */
function extractHash(magnet) {
  const m = magnet.match(/btih:([a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[A-Z2-7]{32})/);
  return m ? m[1].toLowerCase() : '';
}

/** Sanitise a string for use as a filename */
function sanitiseFilename(s) {
  return s.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
}

/** Show a desktop notification */
function notify(title, message) {
  browser.notifications.create({
    type: 'basic',
    iconUrl: browser.runtime.getURL('icons/icon.svg'),
    title: `TorBox — ${title}`,
    message
  });
}
