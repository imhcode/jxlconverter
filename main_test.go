package main

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func testSite() http.Handler {
	big := make([]byte, 4096)
	return newHandler(fstest.MapFS{
		"index.html":          {Data: []byte("<!doctype html><title>JXL</title>")},
		"assets/app-abc.js":   {Data: append([]byte("console.log(1);"), big...)},
		"assets/enc-abc.wasm": {Data: append([]byte("\x00asm"), big...)},
	})
}

func get(t *testing.T, h http.Handler, path string, gz bool) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if gz {
		req.Header.Set("Accept-Encoding", "gzip")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Result()
}

func TestServing(t *testing.T) {
	h := testSite()
	cases := []struct {
		path, status, ctype, cache string
	}{
		{"/", "200 OK", "text/html; charset=utf-8", "no-cache"},
		{"/some/route", "200 OK", "text/html; charset=utf-8", "no-cache"},
		{"/assets/app-abc.js", "200 OK", "text/javascript; charset=utf-8", "public, max-age=31536000, immutable"},
		{"/assets/enc-abc.wasm", "200 OK", "application/wasm", "public, max-age=31536000, immutable"},
		{"/assets/missing.js", "404 Not Found", "", ""},
		{"/favicon.ico", "404 Not Found", "", ""},
	}
	for _, c := range cases {
		res := get(t, h, c.path, false)
		if res.Status != c.status {
			t.Errorf("%s: status %q, want %q", c.path, res.Status, c.status)
			continue
		}
		if c.ctype != "" && res.Header.Get("Content-Type") != c.ctype {
			t.Errorf("%s: content-type %q, want %q", c.path, res.Header.Get("Content-Type"), c.ctype)
		}
		if c.cache != "" && res.Header.Get("Cache-Control") != c.cache {
			t.Errorf("%s: cache %q, want %q", c.path, res.Header.Get("Cache-Control"), c.cache)
		}
	}
}

func TestGzip(t *testing.T) {
	h := testSite()
	res := get(t, h, "/assets/enc-abc.wasm", true)
	if res.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("wasm not gzipped: %v", res.Header)
	}
	zr, err := gzip.NewReader(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(zr)
	if string(body[:4]) != "\x00asm" || len(body) != 4100 {
		t.Fatalf("bad gzip body: %d bytes", len(body))
	}
	if get(t, h, "/assets/enc-abc.wasm", false).Header.Get("Content-Encoding") != "" {
		t.Fatal("gzip sent without Accept-Encoding")
	}
}

func TestHealthAndMethods(t *testing.T) {
	h := testSite()
	if res := get(t, h, "/up", false); res.StatusCode != 200 {
		t.Fatalf("/up = %d", res.StatusCode)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST = %d", rec.Code)
	}
}
