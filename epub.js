// Minimal EPUB reader: ZIP via DecompressionStream, OPF/TOC via DOMParser.
// Every non-EPUB format is turned into EPUB by boko first, so this is the only reader we need.

// ponytail: no zip64, fine for ebooks (<4GB); add it if someone imports a 4GB EPUB.
export async function unzip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = buf.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a ZIP/EPUB file');
  const files = new Map();
  const utf8 = new TextDecoder();
  for (let i = 0, p = dv.getUint32(eocd + 16, true), n = dv.getUint16(eocd + 10, true); i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt ZIP directory');
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), skip = dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    files.set(utf8.decode(buf.subarray(p + 46, p + 46 + nameLen)), { method, data: buf.subarray(start, start + size) });
    p += 46 + nameLen + skip;
  }
  return files;
}

export async function inflate({ method, data }) {
  if (method === 0) return data;
  if (method !== 8) throw new Error(`unsupported ZIP compression method ${method}`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const $$ = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const isExternal = ref => !ref || ref.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(ref);
const resolve = (base, href) => decodeURIComponent(new URL(href, 'http://x/' + base).pathname.slice(1));
const fragment = href => decodeURIComponent(new URL(href, 'http://x/').hash.slice(1));
// Same list boko uses (Metadata::is_rtl in patches/boko-rtl.patch).
const RTL_LANG = /^(ar|arc|ckb|dv|fa|he|iw|ku|ps|sd|ug|ur|yi)\b/i;
const TYPES = { css: 'text/css', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
// Book content may not run scripts or phone home: only resources from inside the book load.
const CSP = "default-src 'none'; img-src blob: data:; style-src blob: data: 'unsafe-inline'; font-src blob: data:; media-src blob: data:";

function parseDoc(src, xml = true) {
  if (xml) {
    const doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
    if (!doc.getElementsByTagName('parsererror').length) return doc;
  }
  return new DOMParser().parseFromString(src, 'text/html');
}

export async function openEpub(blob) {
  const zip = await unzip(blob);
  const bytes = path => {
    const entry = zip.get(path);
    if (!entry) return Promise.reject(new Error(`missing file in EPUB: ${path}`));
    return inflate(entry);
  };
  const text = async path => new TextDecoder().decode(await bytes(path));
  const xml = async path => new DOMParser().parseFromString(await text(path), 'application/xml');

  const opfPath = $$(await xml('META-INF/container.xml'), 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB has no package document');
  const opf = await xml(opfPath);
  const items = $$(opf, 'item').map(el => ({
    id: el.getAttribute('id'),
    path: resolve(opfPath, el.getAttribute('href')),
    type: el.getAttribute('media-type') || '',
    props: el.getAttribute('properties') || '',
  }));
  const byId = new Map(items.map(i => [i.id, i]));
  const byPath = new Map(items.map(i => [i.path, i]));
  const spine = $$(opf, 'itemref').map(r => byId.get(r.getAttribute('idref'))).filter(Boolean);
  if (!spine.length) throw new Error('EPUB has an empty spine');
  // Reading direction: the spine says so, or the language implies it (many RTL EPUB 2 books never say).
  const lang = $$(opf, 'language')[0]?.textContent.trim() ?? '';
  const ppd = $$(opf, 'spine')[0]?.getAttribute('page-progression-direction');
  const dir = ppd === 'rtl' || (ppd !== 'ltr' && RTL_LANG.test(lang)) ? 'rtl' : 'ltr';

  const coverMeta = $$(opf, 'meta').find(m => m.getAttribute('name') === 'cover')?.getAttribute('content');
  const coverItem = items.find(i => /\bcover-image\b/.test(i.props))
    ?? byId.get(coverMeta)
    ?? items.find(i => i.type.startsWith('image/') && /cover/i.test(i.id + i.path));

  // TOC: EPUB3 nav document, else EPUB2 NCX. Entries are { label, path, frag, depth }.
  const toc = [];
  const entry = (label, base, href, depth) => href && toc.push({ label: label.trim().replace(/\s+/g, ' '), path: resolve(base, href), frag: fragment(href), depth });
  const navItem = items.find(i => /\bnav\b/.test(i.props));
  const ncxItem = byId.get($$(opf, 'spine')[0]?.getAttribute('toc')) ?? items.find(i => i.type === 'application/x-dtbncx+xml');
  if (navItem) {
    const nav = parseDoc(await text(navItem.path));
    const navs = $$(nav, 'nav');
    const root = navs.find(n => (n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type')) === 'toc') ?? navs[0];
    const walk = (ol, depth) => {
      for (const li of ol?.children ?? []) {
        const a = [...li.children].find(c => c.localName === 'a' || c.localName === 'span');
        if (a) entry(a.textContent, navItem.path, a.getAttribute('href'), depth);
        walk([...li.children].find(c => c.localName === 'ol'), depth + 1);
      }
    };
    if (root) walk($$(root, 'ol')[0], 0);
  }
  if (!toc.length && ncxItem) {
    const walk = (el, depth) => {
      for (const np of el.children) {
        if (np.localName !== 'navPoint') continue;
        entry($$(np, 'text')[0]?.textContent ?? '', ncxItem.path, $$(np, 'content')[0]?.getAttribute('src'), depth);
        walk(np, depth + 1);
      }
    };
    walk($$(await xml(ncxItem.path), 'navMap')[0] ?? { children: [] }, 0);
  }

  const urls = new Map();
  const url = path => {
    if (!urls.has(path)) urls.set(path, (async () => {
      const type = byPath.get(path)?.type || TYPES[path.split('.').pop().toLowerCase()] || '';
      let data = await bytes(path);
      if (type === 'text/css') data = await rewriteCss(new TextDecoder().decode(data), path);
      return URL.createObjectURL(new Blob([data], { type }));
    })());
    return urls.get(path);
  };

  // ponytail: url() only, no bare `@import "x.css"`; add it if a book's styles go missing.
  async function rewriteCss(css, base) {
    const re = /url\(\s*(['"]?)([^'")]*)\1\s*\)/g;
    const map = new Map();
    for (const [, , ref] of css.matchAll(re)) {
      if (!isExternal(ref) && !map.has(ref)) map.set(ref, await url(resolve(base, ref)).catch(() => ''));
    }
    return css.replace(re, (m, q, ref) => map.has(ref) ? `url("${map.get(ref)}")` : m);
  }

  // Returns a blob: URL for spine item i with scripts removed and every in-book resource remapped.
  const chapters = new Map();
  const chapter = i => {
    if (!chapters.has(i)) chapters.set(i, (async () => {
      const { path, type } = spine[i];
      if (!type.includes('html')) return url(path);
      const src = await text(path);
      const doc = parseDoc(src, type !== 'text/html');
      const isXml = doc.contentType !== 'text/html';
      $$(doc, 'script').forEach(s => s.remove());
      const jobs = [];
      for (const el of $$(doc, '*')) {
        if (el.localName === 'style') jobs.push(rewriteCss(el.textContent, path).then(t => { el.textContent = t; }));
        for (const at of [...el.attributes]) {
          const n = at.localName;
          if (n === 'style' && at.value.includes('url(')) jobs.push(rewriteCss(at.value, path).then(t => { at.value = t; }));
          else if ((n === 'src' || n === 'poster' || (n === 'href' && el.localName !== 'a')) && !isExternal(at.value)) {
            jobs.push(url(resolve(path, at.value)).then(u => { at.value = u; }, () => at.ownerElement?.removeAttributeNode(at)));
          }
        }
      }
      await Promise.all(jobs);
      // Chapters that don't declare a language/direction get the book's.
      const root = doc.documentElement;
      if (lang && !root.hasAttribute('lang') && !root.hasAttribute('xml:lang')) root.setAttribute('lang', lang);
      if (dir === 'rtl' && !root.hasAttribute('dir') && !doc.body?.hasAttribute('dir')) root.setAttribute('dir', 'rtl');
      // Keeps book text out of session replays. rrweb records same-origin frames and only honours
      // the block class inside the frame's document, so it has to be on the chapter itself.
      root.classList.add('siraaj-block');
      const meta = doc.createElementNS('http://www.w3.org/1999/xhtml', 'meta');
      meta.setAttribute('http-equiv', 'Content-Security-Policy');
      meta.setAttribute('content', CSP);
      (doc.head ?? doc.documentElement).prepend(meta);
      const out = isXml ? new XMLSerializer().serializeToString(doc) : '<!DOCTYPE html>' + doc.documentElement.outerHTML;
      return URL.createObjectURL(new Blob([out], { type: isXml ? 'application/xhtml+xml' : 'text/html' }));
    })());
    return chapters.get(i);
  };

  return {
    spine,
    toc,
    dir,
    lang,
    indexOf: path => spine.findIndex(s => s.path === path),
    resolve,
    fragment,
    isExternal,
    chapter,
    cover: async () => coverItem ? new Blob([await bytes(coverItem.path)], { type: coverItem.type }) : null,
    close: async () => {
      for (const p of [...urls.values(), ...chapters.values()]) URL.revokeObjectURL(await p.catch(() => ''));
    },
  };
}
