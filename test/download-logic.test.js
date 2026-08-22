const assert = require('node:assert/strict');
const test = require('node:test');
const DownloadLogic = require('../src/download-logic.js');

test('a single TorBox file is downloaded directly with its real filename', () => {
  const plan = DownloadLogic.createDownloadPlan('Release', [
    { id: 7, name: 'Release/video.mkv' }
  ]);

  assert.deepEqual(plan, { zip: false, fileId: 7, filename: 'video.mkv' });
});

test('a single extensionless file is still downloaded directly', () => {
  const plan = DownloadLogic.createDownloadPlan('Release', [
    { id: 7, name: 'Release/README' }
  ]);

  assert.deepEqual(plan, { zip: false, fileId: 7, filename: 'README' });
});

test('multiple TorBox files require a zip archive', () => {
  const plan = DownloadLogic.createDownloadPlan('Release', [
    { id: 7, name: 'Release/video.mkv' },
    { id: 8, name: 'Release/readme.txt' }
  ]);

  assert.deepEqual(plan, { zip: true, fileId: null, filename: 'Release.zip' });
});

test('a file without a TorBox id requires a zip link', () => {
  const plan = DownloadLogic.createDownloadPlan('Release', ['Release/video.mkv']);

  assert.deepEqual(plan, { zip: true, fileId: null, filename: 'Release.zip' });
});

test('zip plans do not duplicate the zip extension', () => {
  const plan = DownloadLogic.createDownloadPlan('Release.zip', []);

  assert.equal(plan.filename, 'Release.zip');
});

test('filenames are flattened and safe for Firefox downloads', () => {
  assert.equal(DownloadLogic.sanitiseFilename('../.bad<>:"|?*name. '), 'bad_______name');
  assert.equal(DownloadLogic.sanitiseFilename('...'), 'download');
  assert.equal(DownloadLogic.sanitiseFilename('CON.txt'), '_CON.txt');
});

test('magnet parsing decodes display names and accepts case-insensitive parameters', () => {
  const parsed = DownloadLogic.parseSource('MAGNET:?DN=Movie%20Night%3A%20Part+1&XT=urn%3Abtih%3A94E41EA241F81152982422B24E5C25A097424331');

  assert.deepEqual(parsed, {
    type: 'magnet',
    hash: '94e41ea241f81152982422b24e5c25a097424331',
    name: 'Movie Night: Part 1',
    uploadFilename: ''
  });
});

test('torrent URL parsing removes query strings and the torrent extension', () => {
  const parsed = DownloadLogic.parseSource('https://example.test/files/My%20Release.torrent?download=1');

  assert.deepEqual(parsed, {
    type: 'torrent',
    hash: '',
    name: 'My Release',
    uploadFilename: 'My Release.torrent'
  });
});

test('direct links use file_id and archive links use zip_link', () => {
  assert.equal(
    DownloadLogic.buildDownloadLink(42, 'a key', { zip: false, fileId: 7 }),
    'https://api.torbox.app/v1/api/torrents/requestdl?token=a%20key&torrent_id=42&file_id=7&redirect=true&append_name=true'
  );
  assert.equal(
    DownloadLogic.buildDownloadLink(42, 'a key', { zip: true, fileId: null }),
    'https://api.torbox.app/v1/api/torrents/requestdl?token=a%20key&torrent_id=42&zip_link=true&redirect=true&append_name=true'
  );
});
