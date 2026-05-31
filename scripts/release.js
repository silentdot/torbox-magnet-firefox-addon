/**
 * Release script — bumps version, builds, signs, stages, commits, tags, pushes.
 *
 * Usage:
 *   node scripts/release.js          # prompts for version bump type
 *   node scripts/release.js 1.3.0    # explicit version
 *
 * Requires AMO_JWT_ISSUER and AMO_JWT_SECRET in .env
 */

var fs = require('fs');
var path = require('path');
var execSync = require('child_process').execSync;

// --- helpers ---
function run(cmd, opts) {
  console.log('$ ' + cmd);
  execSync(cmd, { cwd: PROJECT, stdio: 'inherit', shell: true, ...opts });
}

function read(file) { return fs.readFileSync(path.join(PROJECT, file), 'utf8'); }
function write(file, content) { fs.writeFileSync(path.join(PROJECT, file), content, 'utf8'); }

var PROJECT = path.join(__dirname, '..');

// --- parse args ---
var newVer = process.argv[2];

if (!newVer) {
  var cur = JSON.parse(read('manifest.json')).version;
  var parts = cur.split('.').map(Number);
  var suggestions = [
    (parts[0]+1) + '.0.0',
    parts[0] + '.' + (parts[1]+1) + '.0',
    parts[0] + '.' + parts[1] + '.' + (parts[2]+1)
  ];
  console.log('Current version: ' + cur);
  console.log('Suggestions:');
  console.log('  major: ' + suggestions[0]);
  console.log('  minor: ' + suggestions[1]);
  console.log('  patch: ' + suggestions[2]);
  console.log('');
  // Use patch bump by default
  newVer = suggestions[2];
  console.log('Using: ' + newVer);
}

// Validate version format
if (!/^\d+\.\d+\.\d+$/.test(newVer)) {
  console.error('Invalid version: ' + newVer + ' (expected x.y.z)');
  process.exit(1);
}

// ---- 1. Bump version in manifest.json ---
console.log('\n=== Bumping to v' + newVer + ' ===');
var manifest = JSON.parse(read('manifest.json'));
manifest.version = newVer;
write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

// ---- 2. Bump version in background.js ---
var bg = read('src/background.js');
bg = bg.replace(/var MANIFEST_VERSION = "\d+\.\d+\.\d+";/, 'var MANIFEST_VERSION = "' + newVer + '";');
write('src/background.js', bg);

// ---- 3. Bump version in popup.html (settings drawer) ---
var popup = read('src/popup.html');
popup = popup.replace(/TorBox Magnet v\d+\.\d+\.\d+/, 'TorBox Magnet v' + newVer);
write('src/popup.html', popup);

// ---- 4. Build ---
console.log('\n=== Building ===');
run('npx web-ext build');

// ---- 5. Sign ---
console.log('\n=== Signing ===');
run('node scripts/sign.js');

// ---- 6. Copy signed .xpi to releases/ ---
console.log('\n=== Staging release artifact ===');
var artifactsDir = path.join(PROJECT, 'web-ext-artifacts');
var releasesDir = path.join(PROJECT, 'releases');
if (!fs.existsSync(releasesDir)) fs.mkdirSync(releasesDir);

// Find the signed xpi (most recent .xpi)
var xpis = fs.readdirSync(artifactsDir).filter(f => f.endsWith('.xpi'));
if (xpis.length === 0) {
  console.error('No signed .xpi found in web-ext-artifacts/');
  process.exit(1);
}
// Sort by modification time to get the latest
xpis.sort(function(a, b) {
  return fs.statSync(path.join(artifactsDir, b)).mtimeMs - fs.statSync(path.join(artifactsDir, a)).mtimeMs;
});

var srcXpi = path.join(artifactsDir, xpis[0]);
var dstXpi = path.join(releasesDir, 'torbox_magnet-' + newVer + '.xpi');
fs.copyFileSync(srcXpi, dstXpi);
console.log('Copied: ' + xpis[0] + ' -> releases/torbox_magnet-' + newVer + '.xpi');

// ---- 7. Update update.json ---
console.log('\n=== Updating update.json ===');
var updateJson = JSON.parse(read('update.json'));
updateJson.addons['torbox-magnet@dev'].updates[0] = {
  version: newVer,
  update_link: 'https://github.com/silentdot/torbox-magnet-firefox-addon/releases/download/v' + newVer + '/torbox_magnet-' + newVer + '.xpi'
};
write('update.json', JSON.stringify(updateJson, null, 2) + '\n');

// ---- 8. Git commit and tag ---
console.log('\n=== Git: committing and tagging ===');
var msg = 'v' + newVer;
run('git add -A');
run('git commit -m "' + msg + '"');
run('git tag ' + msg);

console.log('\n=== Done! v' + newVer + ' is ready. ===');
console.log('');
console.log('To push:  git push origin main --tags');
console.log('GitHub Actions will auto-create the release.');
