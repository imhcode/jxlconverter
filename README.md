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
