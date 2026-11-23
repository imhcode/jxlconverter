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

Single binary (the web app embedded in a Go server, needs Go 1.24+):

```bash
npm run build:bin
./bin/jxlconverter                 # http://127.0.0.1:8090  (-addr to change)
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
- **Large images**: the libjxl WASM build is limited to 2 GB of memory. Measured: ~20 MP encodes, ~24 MP aborts
  (the browser reports it as "index out of bounds" in Firefox, "memory access out of bounds" in Chrome), in both
  lossy and lossless mode. Images above 16 MP (`MAX_PIXELS` in `src/limits.ts`) are scaled down to fit, and the
  row says so (e.g. "Resized 6000×4000 → 4898×3265"). If a conversion still runs out of memory, the worker is
  replaced so the next file is unaffected.

## Deploy (single binary + Cloudflare Tunnel)

`.github/workflows/deploy.yml` builds `jxlconverter` (Linux amd64 + arm64) with the web app embedded.

- **Push to `main`**: uploads the binary to `~/jxlconverter/jxlconverter` on the server over SSH,
  installs the systemd **user** service from `deploy/jxlconverter.service`, restarts it, and checks
  `http://127.0.0.1:8090/up`. No root, no Nginx.
- **Push a tag `v*`** (e.g. `git tag v1.0.0 && git push origin v1.0.0`): publishes a GitHub Release
  with both binaries and `SHA256SUMS`.

### One-time setup

1. **Server** (once, so the user service survives logout and reboot):

   ```bash
   sudo loginctl enable-linger <user>
   ```

2. **Repository secrets** (Settings → Secrets and variables → Actions):

   | Secret | Required | Value |
   |---|---|---|
   | `SSH_KEY` | yes | Full contents of the private key `jxl_deploy` |
   | `SSH_HOST` | yes | Server IP or hostname |
   | `SSH_USER` | yes | User whose `authorized_keys` has `jxl_deploy.pub` |
   | `SSH_PORT` | no | Defaults to `22` |
   | `SSH_KNOWN_HOSTS` | no | `<host> ssh-ed25519 AAAA…` (from `/etc/ssh/ssh_host_ed25519_key.pub`) to pin the host key |
   | `VITE_GA_ID` | no | GA4 Measurement ID, baked in at build time |

3. **Cloudflare** Zero Trust → Networks → Tunnels → your tunnel → **Public Hostname** → add your
   domain with service `HTTP` → `localhost:8090`.

### Manual install from a Release (without Actions)

```bash
mkdir -p ~/jxlconverter ~/.config/systemd/user
curl -fL -o ~/jxlconverter/jxlconverter https://github.com/imhcode/jxlconverter/releases/latest/download/jxlconverter-linux-amd64
chmod 755 ~/jxlconverter/jxlconverter
curl -fL -o ~/.config/systemd/user/jxlconverter.service https://raw.githubusercontent.com/imhcode/jxlconverter/main/deploy/jxlconverter.service
systemctl --user daemon-reload && systemctl --user enable --now jxlconverter
curl http://127.0.0.1:8090/up
```
