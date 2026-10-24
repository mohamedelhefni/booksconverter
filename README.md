# Shelf

A lightweight, offline-first Calibre alternative that runs in the browser: an ebook library, a format converter and a reader, installable as a PWA. Conversion is done by [boko](https://github.com/zacharydenton/boko) compiled to WebAssembly. Books are stored in IndexedDB and never leave the device.

- **Library**: add books with the button, by dragging them in, or with "Open with" once installed. Covers and metadata are read by boko. Includes search.
- **Convert**: EPUB, KFX, AZW3 or MOBI in; EPUB, KFX, AZW3 or Markdown out.
- **Read**: scrolling reader with TOC, font size, light/sepia/dark themes and saved position. Non-EPUB books are converted to EPUB once, when they're imported.
- **RTL**: Arabic UI with a mirrored layout (picked from the browser language, or toggle it in the header). Right-to-left books (Arabic, Hebrew, Persian, Urdu, ...) get the right text direction even when they only declare a language. Page turns, ←/→ keys and the progress bar follow the book's direction. Search ignores Arabic diacritics and letter variants (أ/إ/آ, ى/ي, ة/ه).

## Run

    python3 -m http.server 8000      # any static server; then open http://localhost:8000

The prebuilt wasm is in `pkg/`, so no build is needed to run or deploy. Installing the PWA needs HTTPS (or localhost).

## Deploy

Live at https://ebook.hefni101.dev, served by Cloudflare as a static-assets Worker (`wrangler.jsonc`):

    npx wrangler@4 deploy

Only the files allowlisted in `.assetsignore` are uploaded. Add new app files there and to `SHELL` in `sw.js`.

## Analytics

On `ebook.hefni101.dev` only, `app.js` loads [Siraaj](https://github.com/mohamedelhefni/Siraaj-analytics) from `analytics.hefni101.dev`, with page views and session replay. Book content stays out of recordings: the reader frame has `siraaj-block`, and everything derived from a book (library grid, details dialog, status line, TOC, page title) has `siraaj-mask`. Give any new UI that shows book data one of those classes. The SDK honours Do Not Track.

## Rebuild boko

    brew install rustup wasm-pack && rustup toolchain install stable --target wasm32-unknown-unknown
    ./build.sh          # clones boko at the pinned commit into .boko/, applies patches/, writes pkg/
    bun check.mjs       # smoke test: every format in -> every format out, the EPUB is readable, RTL survives

`patches/boko-rtl.patch` teaches boko text direction: CSS `direction` and `dir` attributes, RTL KFX output (document and per-paragraph direction, `text-align: start/end`), page direction through KFX and AZW3 (EXTH 527), and `lang`/`dir` on chapters it rebuilds. Without it, Arabic books converted to KFX lay out left-to-right on a Kindle. It includes boko tests (`cargo test` passes in `.boko/`) and is meant to go upstream.

After changing any shell file, bump `VERSION` in `sw.js` so installed copies update.

## License

boko is GPL-3.0-or-later, and this app ships it, so distribute Shelf under GPL-3.0-or-later too.
