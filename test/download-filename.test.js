const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadBackground(downloads, tabs, apiKey) {
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
  const context = vm.createContext({ browser, fetch() {}, setInterval() {}, console, FormData });
  vm.runInContext(fs.readFileSync('src/background.js', 'utf8'), context);
  return context;
}

test('direct archive downloads use the archive filename', async () => {
  const downloads = { calls: [], download(options) { downloads.calls.push(options); return Promise.resolve(1); } };
  const tabs = { create() {} };
  const background = loadBackground(downloads, tabs);

  await background.startDownload(42, 'api-key', 'archive.zip', '', '', false);

  assert.equal(downloads.calls[0].filename, 'archive.zip');
});

test('zip-wrapped downloads get a .zip filename', async () => {
  const downloads = { calls: [], download(options) { downloads.calls.push(options); return Promise.resolve(1); } };
  const tabs = { create() {} };
  const background = loadBackground(downloads, tabs);

  await background.startDownload(7, 'api-key', 'Some Release', '', '', true);

  assert.equal(downloads.calls[0].filename, 'Some Release.zip');
});

test('history downloads open the direct download link', async () => {
  const downloads = { calls: [], download() { downloads.calls.push(true); return Promise.reject(new Error('downloads API failed')); } };
  const tabs = { calls: [], create(options) { tabs.calls.push(options); return Promise.resolve(); } };
  const background = loadBackground(downloads, tabs, 'api-key');

  const result = await background.handleMessage({ type: 're-download', torrentId: 42, name: 'archive.zip', zipWrap: false });

  assert.equal(result.ok, true);
  assert.equal(tabs.calls[0].url, 'https://api.torbox.app/v1/api/torrents/requestdl?token=api-key&torrent_id=42&zip_link=false&redirect=true&append_name=true');
  assert.equal(downloads.calls.length, 0);
});
