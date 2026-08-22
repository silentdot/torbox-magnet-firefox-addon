const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadBackground(downloads, tabs, apiKey, fetchImpl, FormDataImpl) {
  const noop = { addListener() {} };
  const browser = {
    runtime: { onInstalled: noop, onStartup: noop, onMessage: noop, getURL() { return ''; } },
    alarms: { onAlarm: noop, create() {} },
    contextMenus: { onClicked: noop, removeAll() { return Promise.resolve(); }, create() {} },
    storage: { local: { get() { return Promise.resolve(apiKey ? { torbox_api_key: apiKey } : {}); }, set() { return Promise.resolve(); } } },
    notifications: { create() {} },
    downloads: { download: downloads.download },
    tabs: { create: tabs.create }
  };
  const context = vm.createContext({ browser, fetch: fetchImpl || function () {}, setInterval() {}, console, FormData: FormDataImpl || FormData });
  vm.runInContext(fs.readFileSync('src/download-logic.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('src/background.js', 'utf8'), context);
  return context;
}

test('direct archive downloads use the archive filename', async () => {
  const downloads = { calls: [], download(options) { downloads.calls.push(options); return Promise.resolve(1); } };
  const tabs = { create() {} };
  const background = loadBackground(downloads, tabs);

  await background.startDownload(42, 'api-key', 'archive.zip', '', '', false, false, 9);

  assert.equal(downloads.calls[0].filename, 'archive.zip');
  assert.match(downloads.calls[0].url, /[?&]file_id=9(?:&|$)/);
});

test('zip-wrapped downloads get a .zip filename', async () => {
  const downloads = { calls: [], download(options) { downloads.calls.push(options); return Promise.resolve(1); } };
  const tabs = { create() {} };
  const background = loadBackground(downloads, tabs);

  await background.startDownload(7, 'api-key', 'Some Release', '', '', true);

  assert.equal(downloads.calls[0].filename, 'Some Release.zip');
});

test('download filenames never use dot-prefixed or dot-suffixed path components', async () => {
  const downloads = {
    calls: [],
    download(options) {
      downloads.calls.push(options);
      if (/^\.|\.$/.test(options.filename)) return Promise.reject(new Error('Invalid filename'));
      return Promise.resolve(1);
    }
  };
  const background = loadBackground(downloads, { create() {} });

  await background.startDownload(42, 'api-key', '.Release.', '', '', false, false, 7);

  assert.equal(downloads.calls[0].filename, 'Release');
});

test('single-file downloads select the TorBox file id instead of requesting a zip', () => {
  const background = loadBackground({ download() {} }, { create() {} });

  const link = background.buildDownloadLink(42, 'api-key', false, 7);

  assert.equal(link, 'https://api.torbox.app/v1/api/torrents/requestdl?token=api-key&torrent_id=42&file_id=7&redirect=true&append_name=true');
});

test('history downloads open the direct download link', async () => {
  const downloads = { calls: [], download() { downloads.calls.push(true); return Promise.reject(new Error('downloads API failed')); } };
  const tabs = { calls: [], create(options) { tabs.calls.push(options); return Promise.resolve(); } };
  const background = loadBackground(downloads, tabs, 'api-key');

  const result = await background.handleMessage({ type: 're-download', torrentId: 42, name: 'archive.zip', zipWrap: false, fileId: 7 });

  assert.equal(result.ok, true);
  assert.equal(tabs.calls[0].url, 'https://api.torbox.app/v1/api/torrents/requestdl?token=api-key&torrent_id=42&file_id=7&redirect=true&append_name=true');
  assert.equal(downloads.calls.length, 0);
});

test('cache parsing preserves TorBox file ids', async () => {
  const fetchImpl = () => Promise.resolve({
    ok: true,
    json: async () => ({
      data: {
        ABC: { cached: true, files: [{ id: 7, name: 'Release/video.mkv' }] }
      }
    })
  });
  const background = loadBackground({ download() {} }, { create() {} }, '', fetchImpl);

  const result = await background.checkCache('abc', 'api-key');

  assert.equal(result.files[0].id, 7);
  assert.equal(result.files[0].name, 'Release/video.mkv');
});

test('single cached files resolve their file id from the torrent list', async () => {
  const fetchImpl = url => Promise.resolve({
    ok: true,
    json: async () => ({
      data: { id: 42, files: [{ id: 7, name: 'Release/video.mkv' }] }
    })
  });
  const background = loadBackground({ download() {} }, { create() {} }, '', fetchImpl);

  const plan = await background.resolveDownloadPlan(42, 'api-key', 'Release', ['Release/video.mkv']);

  assert.equal(plan.zip, false);
  assert.equal(plan.fileId, 7);
  assert.equal(plan.filename, 'video.mkv');
});

test('magnet submissions accept the current TorBox torrent id response', async () => {
  const magnet = 'magnet:?xt=urn:btih:94E41EA241F81152982422B24E5C25A097424331&dn=Mutiny+2026+1080p+WEB-DL+HEVC+x265+5.1+BONE&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2F&tr=http%3A%2F%2Ftracker.renfei.net%3A8080%2Fannounce&tr=http%3A%2F%2Ftracker.bittor.pw%3A1337%2Fannounce&tr=http%3A%2F%2Ftracker.dler.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.tryhackx.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fbittorrent-tracker.e-n-c-r-y-p-t.net%3A1337%2Fannounce&tr=https%3A%2F%2Ftracker.nekomi.cn%2Fannounce&tr=http%3A%2F%2Fbt2.archive.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.bluefrog.pw%3A2710%2Fannounce&tr=udp%3A%2F%2Ftracker.opentorrent.top%3A6969%2Fannounce&tr=http%3A%2F%2Ftracker.renfei.net%3A8080%2Fannounce&tr=https%3A%2F%2Ftr.nyacat.pw%2Fannounce&tr=https%3A%2F%2Ftorrents.tmtime.dev%3A443%2Fannounce&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=http%3A%2F%2Ftracker.openbittorrent.com%3A80%2Fannounce&tr=udp%3A%2F%2Fopentracker.i2p.rocks%3A6969%2Fannounce&tr=http%3A%2F%2Ftracker.internetwarriors.net%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fcoppersurfer.tk%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.zer0day.to%3A1337%2Fannounce';
  class TestFormData {
    append() {}
  }
  const background = loadBackground(
    { download() {} },
    { create() {} },
    '',
    () => Promise.resolve({ ok: true, json: async () => ({ success: true, data: { torrentId: 42 } }) }),
    TestFormData
  );

  const result = await background.sendToTorbox(magnet, 'api-key');

  assert.equal(result.torrentId, 42);
  assert.equal(result.hash, '94e41ea241f81152982422b24e5c25a097424331');
  assert.equal(result.name, 'Mutiny 2026 1080p WEB-DL HEVC x265 5.1 BONE');
});
