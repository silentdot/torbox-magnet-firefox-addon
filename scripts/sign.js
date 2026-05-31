// Load .env and run web-ext sign
const execSync = require('child_process').execSync;
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('Missing .env. Create it with:\n  AMO_JWT_ISSUER=user:NNNNNN:NNN\n  AMO_JWT_SECRET=your-secret');
  process.exit(1);
}

var env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(function(l) {
  var m = l.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
  if (m) env[m[1]] = m[2];
});

if (!env.AMO_JWT_ISSUER || !env.AMO_JWT_SECRET) {
  console.error('.env is missing AMO_JWT_ISSUER or AMO_JWT_SECRET');
  process.exit(1);
}

var cmd = 'npx web-ext sign --channel=unlisted --api-key="' + env.AMO_JWT_ISSUER + '" --api-secret="' + env.AMO_JWT_SECRET + '"';
console.log('Signing...');
execSync(cmd, { cwd: path.join(__dirname, '..'), stdio: 'inherit', shell: true });
