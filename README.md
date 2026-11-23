# JXL Converter

Convert any image (PNG, JPG, WebP, GIF, AVIF, BMP, SVG, ICO…) to **JPEG XL**, **entirely in your browser**.
Images never leave your device. Encoding uses libjxl compiled to WebAssembly (`@jsquash/jxl`) and runs in Web Workers.

## Run

```bash
npm install
cp .env.example .env   # then fill in your GA4 Measurement ID
npm run dev            # http://localhost:5173
```

Production build (static files in `dist/`, can be hosted anywhere):

```bash
npm run build
npm run preview
```

## Google Analytics 4

Set `VITE_GA_ID=G-XXXXXXXXXX` in `.env`. If it is empty, no analytics script is loaded.
The ID is baked in at build time, so rebuild after changing it.

Events sent (anonymous, never file names or image data):

| Event | Params |
|---|---|
| `files_added` | `count`, `formats` |
| `conversion_complete` | `count`, `input_bytes`, `output_bytes`, `saved_pct`, `quality`, `lossless`, `effort`, `duration_ms` |
| `conversion_error` | `format`, `reason` (`decode` / `encode`) |
| `download` | `type` (`single` / `zip`), `count` |
| `settings_changed` | `setting`, `value` |

## Notes

- Settings (quality, lossless, speed) apply live: changing them re-encodes the current files.
- The WASM runs single-threaded per worker, with a pool of up to 4 workers. That avoids the COOP/COEP headers that would block the GA script.
- JPEG inputs are re-encoded from pixels. Bit-exact lossless JPEG recompression (`cjxl` JPEG transcoding) isn't available in the WASM build.
- HEIC/TIFF only work if the browser itself can decode them (e.g. Safari).

## Deploy (GitHub Actions → your server)

Every push to `main` builds the app and rsyncs `dist/` to your server over SSH
(`.github/workflows/deploy.yml`). You can also run it by hand: **Actions → Deploy → Run workflow**.

### 1. Repository secrets

Add these in **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Required | Value |
|---|---|---|
| `SSH_KEY` | yes | Full contents of the **private** key `jxl_deploy` (including the `BEGIN`/`END` lines) |
| `SSH_HOST` | yes | Server IP or hostname |
| `SSH_USER` | yes | User whose `authorized_keys` has `jxl_deploy.pub` |
| `SSH_PORT` | no | Defaults to `22` |
| `SSH_KNOWN_HOSTS` | no | Output of `ssh-keyscan -p <port> <host>` run on your own machine (pins the host key) |
| `DEPLOY_PATH` | no | Defaults to `jxlconverter` (= `~/jxlconverter`). Use a relative or absolute path, not `~` |
| `VITE_GA_ID` | no | GA4 Measurement ID, baked in at build time |

### 2. One-time server setup (Nginx behind Cloudflare Tunnel)

Nginx serves the site as a name-based virtual host on `127.0.0.1:80`, next to the server's other
sites. The existing Cloudflare Tunnel provides the public hostname and HTTPS, so only SSH needs to be
reachable from the internet.

1. Copy `deploy/nginx.conf.example` to `/etc/nginx/sites-available/jxlconverter`, replace `<user>` and
   `<domain>`, and run the commands at the top of that file.
2. In Cloudflare Zero Trust → Networks → Tunnels → your tunnel → **Public Hostname**, add `<domain>`
   with service `HTTP` → `localhost:80`.
