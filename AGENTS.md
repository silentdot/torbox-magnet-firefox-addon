# AGENTS.md

Guidance for AI agents working in this repository.

## Project overview

Firefox extension ("TorBox Magnet") that sends magnet and `.torrent` links to TorBox and starts downloads. MV2 extension. Key files:

- `manifest.json` — extension manifest, version, permissions, `update_url`
- `src/background.js` — background script (TorBox API calls, context menus, history, auto-update check via `MANIFEST_VERSION`)
- `src/popup.html` / `src/popup.js` / `src/popup.css` — popup UI
- `update.json` — self-hosted update manifest (used by Firefox auto-update via the `update_url` in the manifest)
- `scripts/release.js` — automated release script (bump → build → sign → stage → commit → tag → push)
- `scripts/sign.js` — signs the addon with AMO credentials from `.env`
- `.github/workflows/release.yml` — creates the GitHub Release on `v*` tag push

## Release process

Bumping the version and shipping a release is the most error-prone operation in this repo. **Read `release.md` and follow it exactly.** Key points:

- The version lives in **five** places that must stay in sync: `manifest.json`, `package.json`, `src/background.js` (`MANIFEST_VERSION`), `src/popup.html` (`#extension-version`), and `update.json`.
- A release must ship a **Mozilla-signed** `.xpi` (verify `META-INF/mozilla.rsa` exists inside the zip) named `torbox_magnet-<version>.xpi` staged in `releases/`.
- `npm run sign` can take several minutes (AMO approval queue). **Never interrupt it.** If interrupted, the upload is already submitted — re-running fails with "This upload has already been submitted." Instead, poll the AMO API for `status: public` and download the signed file directly. See `release.md` for the recovery steps.
- The GitHub Actions workflow (`.github/workflows/release.yml`) runs on `v*` tag push: it finds the signed xpi, rewrites `update.json`, and creates the release. Pushing the tag is what triggers the actual release.
- After tagging and pushing, verify `gh release view v<version> --json assets` shows the expected `.xpi` and that it matches `update.json`'s `update_link`.

## Conventions

- No comments in code unless asked.
- Version bumps must keep all five version locations in sync.
- `releases/` holds the signed xpi for each release and is committed to the repo.
- `.env` (AMO credentials) and `web-ext-artifacts/` are gitignored.
