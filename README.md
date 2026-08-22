# TorBox Magnet

A Firefox extension that sends magnet and `.torrent` links directly to your [TorBox](https://torbox.app) account and starts the download when it is ready.

## Features

- **Direct context-menu download** — Right-click any magnet link or `.torrent` file link → Send to TorBox and start download
- **Smart archive detection** — Single `.rar`/`.7z`/`.zip` files download as-is; multi-file torrents bundle as `.zip`
- **Cache-aware** — Cached torrents download immediately; uncached ones queue on TorBox servers
- **Queued readiness notifications** — Queued torrents are checked every 30 seconds and notify once when ready
- **Content type badges** — History shows file-type icons (archive, video, audio, image, doc, app)
- **Download history** — Last 200 items with re-download, direct download link, and remove
- **Direct links from history** — Copy a TorBox download link for an item from the popup history
- **Lazy validation** — API key checked once per session, not every popup open
- **Persistent profile** — Settings survive browser restarts
- **TorBox-themed** — Dark glassmorphism UI with brand `#04bf8a` accent

## How it works

1. You right-click a magnet or `.torrent` link and choose **Send to TorBox and start download**.
2. The background script reads the API key from Firefox local storage. Magnet links go straight to TorBox. For a `.torrent` URL, the extension downloads the file first and uploads it to TorBox.
3. TorBox returns a torrent ID. The extension checks whether the torrent is cached and reads its file list.
4. A torrent with one file downloads that file directly with its TorBox file ID. A torrent with multiple files downloads as a ZIP. If TorBox has not returned enough file data to select one file, the extension uses a ZIP because the download endpoint requires either a file ID or a ZIP request.
5. Before calling Firefox's download API, the extension removes path segments and characters that Firefox or Windows reject. Direct downloads use the real file name. ZIP downloads use the torrent name with one `.zip` extension.
6. If the torrent is not ready, the extension saves it in local history and checks TorBox every 30 seconds. Once the files are ready, it records the download choice and shows a notification.
7. The popup reads that local history. You can start the same download again, copy its TorBox link, open the TorBox dashboard, or remove the history entry.

The API key and download history stay in Firefox local storage. Download data comes from TorBox and goes directly to Firefox's download manager; the extension does not proxy file contents through another server.

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
    popup.js             # Popup logic — lazy validation and history
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
| `GET /v1/api/torrents/checkcached` | Check cache status + list files |
| `GET /v1/api/torrents/requestdl` | Request the direct download link |
| `GET /v1/api/user/me` | Validate API key |

## License

MIT
