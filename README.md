# TorBox Magnet

A Firefox extension that sends magnet links directly to your [TorBox](https://torbox.app) account. Right-click any magnet link on a webpage and send it to TorBox with one click.

## Features

- **Right-click send** — Right-click any magnet link or .torrent file link → Send to TorBox
- **Smart archive detection** — Single `.rar`/`.7z`/`.zip` files download as-is; multi-file torrents bundle as `.zip`
- **Cache-aware** — Cached torrents download immediately; uncached ones queue on TorBox servers
- **Content type badges** — History shows file-type icons (archive, video, audio, image, doc, app)
- **Download history** — Last 200 items with re-download, copy magnet link, and remove
- **Copy magnet link** — Right-click any magnet link → Copy magnet link
- **Send page magnets** — One-click send all unique magnet links on a page
- **Lazy validation** — API key checked once per session, not every popup open
- **Persistent profile** — Settings survive browser restarts
- **TorBox-themed** — Dark glassmorphism UI with brand `#04bf8a` accent

## Installation

### Quick start (development)

```bash
# Install dependencies
npm install

# Launch Firefox with the extension loaded (auto-reloads on file changes)
npm run dev
```

This opens Firefox with the extension installed temporarily. File changes in `src/` or `manifest.json` reload the extension automatically.

### Permanent installation (unsigned)

Firefox requires extensions to be signed by Mozilla for permanent installation in the release version. For testing in Developer Edition or Nightly:

1. **Build the extension:**
   ```bash
   npm run build
   ```
   Creates `web-ext-artifacts/torbox_magnet-1.0.0.zip`.

2. **Set up Firefox Developer Edition:**
   - Install [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/)
   - Go to `about:config`
   - Set `xpinstall.signatures.required` to `false`

3. **Install the addon:**
   - Go to `about:addons`
   - Click the gear icon → **Install Add-on From File**
   - Select the `.zip` from `web-ext-artifacts/`

### Loading as temporary addon (any Firefox version)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from the project folder

> **Note:** Temporary addons lose their storage when Firefox restarts (unless you use the dev profile with `npm run dev`). This is fine for testing.

### Building for AMO submission (signed)

To get a Mozilla-signed addon for permanent installation in release Firefox:

```bash
# Requires Mozilla Add-ons API credentials
# npm run sign
```

See [Mozilla's extension signing docs](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) for details.

## Configuration

1. Get your TorBox API key from [torbox.app/settings](https://torbox.app/settings)
2. Click the TorBox icon in the toolbar
3. Paste your API key and click **Connect**

Your key is validated once per Firefox session and cached — no repeated API calls on every popup open.

## Development

```bash
# Launch with auto-reload
npm run dev

# Launch with Firefox Developer Edition
npm run dev:firefox-dev

# Lint the addon
npm run lint

# Package for distribution
npm run build
```

### Project structure

```
torbox-magnet-firefox-addon/
  manifest.json          # Extension manifest
  icons/icon.svg         # Extension icon (magnet U-shape)
  src/
    background.js        # Background script — API calls, context menus, history
    popup.html           # Popup UI — connect panel, history, settings drawer
    popup.js             # Popup logic — lazy validation, history, file-type badges
    popup.css            # TorBox-themed glassmorphism design
    options.html         # (legacy — settings are inline in the popup)
    options.js           # (legacy)
  .web-ext-config.mjs    # web-ext dev configuration
  package.json           # npm scripts (dev, build, lint)
```

## API

This extension uses the [TorBox API](https://api.torbox.app/docs):

| Endpoint | Purpose |
|---|---|
| `POST /v1/api/torrents/createtorrent` | Submit magnet link |
| `POST /v1/api/torrents/checkcached` | Check cache status + list files |
| `GET /v1/api/torrents/requestdl` | Download cached torrent as ZIP |
| `GET /v1/api/user/me` | Validate API key |

## License

MIT
