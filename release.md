# Release Process

How to ship a valid signed release. The GitHub Actions workflow (`.github/workflows/release.yml`) is triggered by a `v*` tag push and creates the actual GitHub Release; the steps below produce the signed `.xpi` it needs.

## Prerequisites

- `.env` with valid `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` (Mozilla Add-ons API credentials)
- `gh` CLI authenticated as `silentdot`
- Dependencies installed (`npm install`)
- Working on `master` with a clean tree

## Quick path (automated)

`node scripts/release.js <version>` bumps the version files, builds, signs, stages the signed xpi to `releases/`, updates `update.json`, commits, tags, and pushes. The GitHub Actions workflow then creates the release.

```bash
node scripts/release.js 1.3.0
```

Only use the quick path if signing completes in one shot — see the timeout note below.

## Manual path

### 1. Bump the version

The version lives in **five** places — all must match:

| File | Location |
|---|---|
| `manifest.json` | `version` |
| `package.json` | `version` |
| `src/background.js` | `var MANIFEST_VERSION = 'x.y.z'` (used by the in-extension update check) |
| `src/popup.html` | initial text of `<span id="extension-version">x.y.z</span>` (overwritten at runtime from the manifest) |
| `update.json` | `updates[0].version` and `updates[0].update_link` |

```jsonc
// update.json
"version": "1.3.0",
"update_link": "https://github.com/silentdot/torbox-magnet-firefox-addon/releases/download/v1.3.0/torbox_magnet-1.3.0.xpi"
```

### 2. Build and sign

```bash
npm run sign
```

- This runs `web-ext sign --channel=unlisted`, which builds, uploads to AMO, waits for validation and approval, then downloads the signed `.xpi` to `web-ext-artifacts/`.
- **AMO approval can take several minutes.** Run it with a generous timeout (at least 15 minutes) and **do not interrupt it**.
- The signed file is named with the AMO add-on GUID, e.g. `web-ext-artifacts/10b1b442221e4b0c82db-1.3.0.xpi`.

### 3. Verify the xpi is actually signed

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path "web-ext-artifacts\10b1b442221e4b0c82db-1.3.0.xpi"))
$zip.Entries | Where-Object { $_.FullName -like 'META-INF/*' } | Select-Object FullName
$zip.Dispose()
```

You must see `META-INF/mozilla.rsa`, `META-INF/mozilla.sf`, and `META-INF/manifest.mf`. A bare `web-ext build` zip is **not** signed and will not work.

### 4. Stage the signed xpi under the release name

The workflow and `update.json` expect the file named `torbox_magnet-<version>.xpi` in `releases/`:

```powershell
Copy-Item "web-ext-artifacts\10b1b442221e4b0c82db-1.3.0.xpi" "releases\torbox_magnet-1.3.0.xpi"
```

### 5. Commit, tag, push

```bash
git add manifest.json package.json src/background.js src/popup.html update.json releases/torbox_magnet-1.3.0.xpi
git commit -m "v1.3.0"
git tag v1.3.0
git push origin master --tags
```

The tag push triggers `.github/workflows/release.yml`, which:
1. Locates `releases/torbox_magnet-1.3.0.xpi` (or falls back to `web-ext-artifacts/`)
2. Rewrites and commits `update.json` for the new tag
3. Creates the GitHub Release with the xpi attached

### 6. Verify

```bash
gh release view v1.3.0 --json assets -q '.assets[].name'
# => torbox_magnet-1.3.0.xpi
```

Confirm the release asset matches `update.json`'s `update_link`, so Firefox auto-update resolves.

## Recovering from an interrupted sign

If `npm run sign` is killed while "Waiting for approval...", the version has already been submitted to AMO. **Do not re-run `npm run sign`** — it will fail with `This upload has already been submitted.` Instead:

1. Poll AMO for the version until `status` is `public` (JWT auth required, token = `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`):
   ```
   GET https://addons.mozilla.org/api/v5/addons/addon/torbox-magnet@dev/versions/<version>/
   ```
   The `file.url` field is the signed download URL.
2. Download that URL with the same JWT `Authorization` header into `web-ext-artifacts/`.
3. Continue from step 3 above.
