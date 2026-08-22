var DownloadLogic = (function () {
  var API_URL = 'https://api.torbox.app/v1/api/torrents/requestdl';
  var RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

  function decode(value) {
    try {
      return decodeURIComponent(String(value || '').replace(/\+/g, ' '));
    } catch (error) {
      return String(value || '').replace(/\+/g, ' ');
    }
  }

  function basename(value) {
    return String(value || '').split(/[\\/]/).pop() || '';
  }

  function sanitiseFilename(value) {
    var filename = basename(value)
      .replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_')
      .trim()
      .replace(/^\.+|[. ]+$/g, '')
      .trim();
    if (!filename) filename = 'download';
    if (RESERVED_NAMES.test(filename)) filename = '_' + filename;
    if (filename.length <= 180) return filename;
    var dot = filename.lastIndexOf('.');
    var extension = dot > 0 && filename.length - dot <= 20 ? filename.slice(dot) : '';
    return filename.slice(0, 180 - extension.length).replace(/[. ]+$/g, '') + extension;
  }

  function normaliseFiles(files) {
    if (!Array.isArray(files)) return [];
    var result = [];
    for (var i = 0; i < files.length; i++) {
      var value = files[i];
      if (typeof value === 'string') {
        if (value) result.push({ id: null, name: value });
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      var name = value.name || value.shortName || value.short_name || value.path || '';
      if (!name) continue;
      var id = value.id;
      if (id === undefined || id === null || id === '') id = value.fileId;
      if (id === undefined || id === null || id === '') id = value.file_id;
      if (id === undefined || id === null || id === '') id = null;
      result.push({ id: id, name: name });
    }
    return result;
  }

  function zipFilename(name) {
    var filename = sanitiseFilename(name);
    return /\.zip$/i.test(filename) ? filename : sanitiseFilename(filename + '.zip');
  }

  function createDownloadPlan(torrentName, rawFiles) {
    var files = normaliseFiles(rawFiles);
    if (files.length === 1 && files[0].id !== null) {
      return {
        zip: false,
        fileId: files[0].id,
        filename: sanitiseFilename(files[0].name || torrentName)
      };
    }
    return {
      zip: true,
      fileId: null,
      filename: zipFilename(torrentName || (files[0] && files[0].name) || 'download')
    };
  }

  function queryValues(source) {
    var queryIndex = source.indexOf('?');
    var query = queryIndex === -1 ? '' : source.slice(queryIndex + 1);
    var values = {};
    var parts = query.split('&');
    for (var i = 0; i < parts.length; i++) {
      var equals = parts[i].indexOf('=');
      var key = decode(equals === -1 ? parts[i] : parts[i].slice(0, equals)).toLowerCase();
      var value = decode(equals === -1 ? '' : parts[i].slice(equals + 1));
      if (!values[key]) values[key] = [];
      values[key].push(value);
    }
    return values;
  }

  function parseSource(source) {
    source = String(source || '');
    if (/^magnet:/i.test(source)) {
      var values = queryValues(source);
      var xt = values.xt || [];
      var hash = '';
      for (var i = 0; i < xt.length; i++) {
        var match = xt[i].match(/^urn:btih:([a-f0-9]{40}|[a-f0-9]{64}|[a-z2-7]{32})$/i);
        if (match) {
          hash = match[1].toLowerCase();
          break;
        }
      }
      return {
        type: 'magnet',
        hash: hash,
        name: values.dn && values.dn[0] ? values.dn[0] : 'Unknown',
        uploadFilename: ''
      };
    }
    var withoutQuery = source.split(/[?#]/)[0];
    var uploadFilename = decode(basename(withoutQuery));
    return {
      type: 'torrent',
      hash: '',
      name: uploadFilename.replace(/\.torrent$/i, '') || 'Unknown',
      uploadFilename: uploadFilename || 'torrent.torrent'
    };
  }

  function buildDownloadLink(torrentId, apiKey, plan) {
    if (!torrentId || !apiKey) return '';
    var params = 'token=' + encodeURIComponent(apiKey) + '&torrent_id=' + encodeURIComponent(torrentId);
    if (plan && !plan.zip && plan.fileId !== undefined && plan.fileId !== null && plan.fileId !== '') {
      params += '&file_id=' + encodeURIComponent(plan.fileId);
    } else {
      params += '&zip_link=true';
    }
    return API_URL + '?' + params + '&redirect=true&append_name=true';
  }

  return {
    buildDownloadLink: buildDownloadLink,
    createDownloadPlan: createDownloadPlan,
    normaliseFiles: normaliseFiles,
    parseSource: parseSource,
    sanitiseFilename: sanitiseFilename
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DownloadLogic;
