export default {
  ignoreFiles: [
    'package.json',
    'package-lock.json',
    'node_modules/',
    '.git/',
    '.gitignore',
    '*.md',
    'LICENSE',
    '*.config.*',
    '.*'
  ],
  build: {
    overwriteDest: true,
  },
  run: {
    firefox: 'firefox',
    // Persistent dev profile — uBlock Origin & extension settings survive restarts
    firefoxProfile: './.dev-profile',
    profileCreateIfMissing: true,
    keepProfileChanges: true,
    watchFile: [
      'src/background.js',
      'src/popup.html',
      'src/popup.js',
      'src/popup.css',
      'src/options.html',
      'src/options.js',
      'manifest.json',
      'icons/icon.svg'
    ],
    // Firefox preferences — search engine, start page, dev-friendly defaults
    pref: [
      'browser.startup.homepage=https://1337x.to/popular-games',
      'browser.startup.page=1',
      'browser.search.defaultenginename=DuckDuckGo',
      'browser.search.order.1=DuckDuckGo',
      'browser.tabs.warnOnClose=false',
      'browser.tabs.warnOnOpen=false',
      'extensions.getAddons.showPane=false',
      'extensions.htmlaboutaddons.recommendations.enabled=false',
    ],
    // Firefox args — new instance to avoid touching your main profile
    args: ['--new-instance'],
  },
};
