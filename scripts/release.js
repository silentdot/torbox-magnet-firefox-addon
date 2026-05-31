/**
 * Release script — bumps version, builds, signs, stages, commits, tags, pushes.
 *
 * Usage:
 *   node scripts/release.js          # auto patch bump (1.2.0 -> 1.2.1)
 *   node scripts/release.js 1.3.0    # explicit version
 *
 * Requires AMO_JWT_ISSUER and AMO_JWT_SECRET in .env
 */

var fs = require('fs');
var path = require('path');
var execSync = require('child_process').execSync;

function run(cmd, opts) {
  console.log('$ ' + cmd);
  execSync(cmd, { cwd: PROJECT, stdio: 'inherit', shell: true, ...opts });
}

function read(file) { return fs.readFileSync(path.join(PROJECT, file), 'utf8'); }
function write(file, content) { fs.writeFileSync(path.join(PROJECT, file), content, 'utf8'); }

var PROJECT = path.join(__dirname, '..');

// --- parse version ---
var newVer = process.argv[2];
if (!newVer) {
  var cur = JSON.parse(read('manifest.json')).version;
  var parts = cur.split('.').map(Number);
  parts[2]++;
  newVer = parts.join('.');
  console.log('Auto bump: ' + cur + ' -> ' + newVer);
}
if (!/^\d+\.\d+\.\d+$/.test(newVer)) {
  console.error('Invalid version: ' + newVer + ' (expected x.y.z)');
  process.exit(1);
}

// --- 1. Bump version files ---
console.log('\n=== Bumping to v' + newVer + ' ===');

var manifest = JSON.parse(read('manifest.json'));
manifest.version = newVer;
write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

var bg = read('src/background.js');
bg = bg.replace(/var MANIFEST_VERSION = '\d+\.\d+\.\d+'/, "var MANIFEST_VERSION = '" + newVer + "'");
write('src/background.js', bg);

var popup = read('src/popup.html');
popup = popup.replace(/TorBox Magnet v\d+\.\d+\.\d+/, 'TorBox Magnet v' + newVer);
write('src/popup.html', popup);

// --- 2. Build ---
console.log('\n=== Building ===');
run('npx web-ext build');

// --- 3. Sign ---
console.log('\n=== Signing ===');
run('node scripts/sign.js');

// --- 4. Stage release artifact ---
console.log('\n=== Staging release artifact ===');
var artifactsDir = path.join(PROJECT, 'web-ext-artifacts');
var releasesDir = path.join(PROJECT, 'releases');
if (!fs.existsSync(releasesDir)) fs.mkdirSync(releasesDir);

var xpis = fs.readdirSync(artifactsDir).filter(function(f) { return f.endsWith('.xpi'); });
if (xpis.length === 0) { console.error('No signed .xpi found'); process.exit(1); }
xpis.sort(function(a, b) {
  return fs.statSync(path.join(artifactsDir, b)).mtimeMs - fs.statSync(path.join(artifactsDir, a)).mtimeMs;
});
var dstXpi = path.join(releasesDir, 'torbox_magnet-' + newVer + '.xpi');
fs.copyFileSync(path.join(artifactsDir, xpis[0]), dstXpi);
console.log(' -> releases/torbox_magnet-' + newVer + '.xpi');

// --- 5. Update update.json ---
console.log('\n=== Updating update.json ===');
var updateJson = JSON.parse(read('update.json'));
updateJson.addons['torbox-magnet@dev'].updates[0] = {
  version: newVer,
  update_link: 'https://github.com/silentdot/torbox-magnet-firefox-addon/releases/download/v' + newVer + '/torbox_magnet-' + newVer + '.xpi'
};
write('update.json', JSON.stringify(updateJson, null, 2) + '\n');

// --- 6. Commit, tag, push ---
console.log('\n=== Git: commit, tag, push ===');
var tag = 'v' + newVer;
run('git add -A');
run('git commit -m "' + tag + '"');
run('git tag ' + tag);
// Determine default branch dynamically
var branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT, encoding: 'utf8' }).toString().trim();
run('git push origin ' + branch + ' --tags');

console.log('\n=== Done! v' + newVer + ' released. ===');
console.log('GitHub Actions is creating the release...');
