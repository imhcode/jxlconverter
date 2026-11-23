// Command jxlconverter serves the JXL Converter web app from a single binary.
//
// The Vite build (dist/) is embedded at compile time, so the binary is the
// whole deployment: run it behind Cloudflare Tunnel (or any reverse proxy).
// Image conversion happens in the visitor's browser; this server only ships
// static files and never receives images.
//
// Build: npm run build && go build -o jxlconverter .
package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed all:dist
var embedded embed.FS

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	addr := flag.String("addr", envOr("ADDR", "127.0.0.1:8090"), "listen address")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}

	site, err := fs.Sub(embedded, "dist")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := fs.Stat(site, "index.html"); err != nil {
		log.Fatal("dist/index.html missing: run `npm run build` before `go build`")
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           newHandler(site),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Printf("jxlconverter %s listening on http://%s", version, *addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func init() {
	_ = mime.AddExtensionType(".wasm", "application/wasm")
	_ = mime.AddExtensionType(".jxl", "image/jxl")
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

type handler struct {
	site fs.FS
	gz   sync.Map // path -> *gzEntry
}

type gzEntry struct {
	once sync.Once
	data []byte // nil when compression does not help
}

func newHandler(site fs.FS) http.Handler { return &handler{site: site} }

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	hdr := w.Header()
	hdr.Set("X-Content-Type-Options", "nosniff")
	hdr.Set("Referrer-Policy", "strict-origin-when-cross-origin")

	if r.URL.Path == "/up" {
		hdr.Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("ok\n"))
		return
	}

	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	data, err := fs.ReadFile(h.site, name)
	if err != nil {
		// Unknown asset: real 404. Any other path: serve the app.
		if strings.HasPrefix(name, "assets/") || path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
		name = "index.html"
		if data, err = fs.ReadFile(h.site, name); err != nil {
			http.NotFound(w, r)
			return
		}
	}

	if strings.HasPrefix(name, "assets/") {
		// Vite fingerprints these filenames, so they never change.
		hdr.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		hdr.Set("Cache-Control", "no-cache")
	}
	ctype := mime.TypeByExtension(path.Ext(name))
	if ctype == "" {
		ctype = http.DetectContentType(data)
	}
	hdr.Set("Content-Type", ctype)
	hdr.Add("Vary", "Accept-Encoding")

	body := data
	if compressible(ctype) && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		if gz := h.gzipped(name, data); gz != nil {
			hdr.Set("Content-Encoding", "gzip")
			body = gz
		}
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(body))
}

func compressible(ctype string) bool {
	for _, p := range []string{"text/", "application/javascript", "text/javascript", "application/json", "application/wasm", "image/svg+xml", "application/manifest+json"} {
		if strings.HasPrefix(ctype, p) {
			return true
		}
	}
	return false
}

// gzipped compresses each embedded file once, on first request, and caches it.
func (h *handler) gzipped(name string, data []byte) []byte {
	v, _ := h.gz.LoadOrStore(name, &gzEntry{})
	e := v.(*gzEntry)
	e.once.Do(func() {
		if len(data) < 1024 {
			return
		}
		var buf bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		_, _ = zw.Write(data)
		_ = zw.Close()
		if buf.Len() < len(data) {
			e.data = buf.Bytes()
		}
	})
	return e.data
}
