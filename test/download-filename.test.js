const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadBackground(downloads) {
  const noop = { addListener() {} };
  const browser = {
    runtime: { onInstalled: noop, onStartup: noop, onMessage: noop, getURL() { return ''; } },
    alarms: { onAlarm: noop, create() {} },
    contextMenus: { onClicked: noop, removeAll() { return Promise.resolve(); }, create() {} },
    storage: { local: { get() { return Promise.resolve({}); }, set() { return Promise.resolve(); } } },
    notifications: { create() {} },
    downloads: { download: downloads.download },
    tabs: { create() {} }
  };
  const context = vm.createContext({ browser, fetch() {}, setInterval() {}, console, FormData });
  vm.runInContext(fs.readFileSync('src/background.js', 'utf8'), context);
  return context;
}

test('direct archive downloads use the archive filename', async () => {
  const downloads = { calls: [], download(options) { downloads.calls.push(options); return Promise.resolve(1); } };
  const background = loadBackground(downloads);

  await background.startDownload(42, 'api-key', 'archive.zip', '', '', false);

  assert.equal(downloads.calls[0].filename, 'archive.zip');
});

test('zip-wrapped downloads get a .zip filename', async () => {
  const downloads = { calls: [], download(options) { downloads.calls.push(options); return Promise.resolve(1); } };
  const background = loadBackground(downloads);

  await background.startDownload(7, 'api-key', 'Some Release', '', '', true);

  assert.equal(downloads.calls[0].filename, 'Some Release.zip');
});
