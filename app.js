import { openEpub } from './epub.js';

const $ = id => document.getElementById(id);
const INPUTS = { epub: 'epub', azw3: 'azw3', azw: 'mobi', mobi: 'mobi', kfx: 'kfx' };
const OUTPUTS = {
  epub: ['EPUB', 'epub', 'application/epub+zip'],
  azw3: ['AZW3', 'azw3', 'application/vnd.amazon.mobi8-ebook'],
  kfx: ['KFX', 'kfx', 'application/octet-stream'],
  markdown: ['Markdown', 'md', 'text/markdown'],
};
const say = msg => { $('status').textContent = msg; };
const baseName = name => name.replace(/\.[^.]+$/, '');
const fmtSize = n => n < 1 << 20 ? `${Math.ceil(n / 1024)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`;
const pref = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const setPref = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

// --- UI language. Arabic also mirrors the layout; each book's own direction is handled separately.
const UI_LANG = pref('lang', /^ar\b/i.test(navigator.language) ? 'ar' : 'en');
const LOCALE = UI_LANG === 'ar' ? 'ar-u-nu-latn' : 'en';
const AR = {
  'Search title or author': 'ابحث بالعنوان أو المؤلف',
  'Search library': 'البحث في المكتبة',
  'Add books': 'إضافة كتب',
  'Your library is empty': 'مكتبتك فارغة',
  'Drop EPUB, KFX, AZW3 or MOBI files anywhere on this page. Books are stored on this device and never uploaded.':
    'أفلت ملفات EPUB أو KFX أو AZW3 أو MOBI في أي مكان من هذه الصفحة. تُحفظ الكتب على هذا الجهاز ولا تُرفع إلى أي خادم.',
  'Library': 'المكتبة',
  'Conversion by': 'التحويل بواسطة',
  ', running locally in WebAssembly.': '، ويعمل محليًا عبر WebAssembly.',
  'Close': 'إغلاق',
  'Read': 'قراءة',
  'Download original': 'تنزيل الأصل',
  'Convert to': 'تحويل إلى',
  'Convert & download': 'تحويل وتنزيل',
  'Remove from library': 'إزالة من المكتبة',
  'Reader': 'القارئ',
  'Back to library': 'العودة إلى المكتبة',
  'Table of contents': 'المحتويات',
  'Smaller text': 'تصغير النص',
  'Larger text': 'تكبير النص',
  'Reading theme': 'سمة القراءة',
  'Auto': 'تلقائي',
  'Light': 'فاتح',
  'Sepia': 'سيبيا',
  'Dark': 'داكن',
  'Book content': 'محتوى الكتاب',
  'Prev': 'السابق',
  'Next': 'التالي',
  'Previous chapter': 'الفصل السابق',
  'Next chapter': 'الفصل التالي',
  'Drop to add to your library': 'أفلت الملفات لإضافتها إلى مكتبتك',
  '{name}: not an EPUB, KFX, AZW3 or MOBI file': '{name}: ليس ملف EPUB أو KFX أو AZW3 أو MOBI',
  '{name}: already in your library': '{name}: موجود في مكتبتك مسبقًا',
  'Adding {name}…': 'جارٍ إضافة {name}…',
  'Added 1 book.': 'أُضيف كتاب واحد.',
  'Added {n} books.': 'عدد الكتب المضافة: {n}.',
  "Couldn't add {problem}.": 'تعذّرت إضافة {problem}.',
  'Unknown author': 'مؤلف غير معروف',
  '{n} chapters': 'الفصول: {n}',
  'added {date}': 'أُضيف في {date}',
  'Converting…': 'جارٍ التحويل…',
  'Saved {name} ({size}).': 'حُفظ {name} ({size}).',
  'Remove “{title}” from your library? The file is deleted from this device.':
    'إزالة «{title}» من مكتبتك؟ سيُحذف الملف من هذا الجهاز.',
  'Opening {title}…': 'جارٍ فتح {title}…',
  "Couldn't open {title}: {error}": 'تعذّر فتح {title}: {error}',
  'Contents': 'المحتويات',
  "Couldn't show this chapter: {error}": 'تعذّر عرض هذا الفصل: {error}',
  "Can't open local storage, so books won't be saved: {error}": 'تعذّر فتح التخزين المحلي، لذا لن تُحفظ الكتب: {error}',
  'the converter crashed': 'توقّف المحوّل عن العمل',
};
// Interpolated values (file names, titles, errors) are bidi-isolated so they can't scramble the sentence around them.
const t = (s, vars = {}) => ((UI_LANG === 'ar' && AR[s]) || s).replace(/\{(\w+)\}/g, (_, k) => `\u2068${vars[k]}\u2069`);
function translatePage() {
  document.documentElement.lang = UI_LANG;
  document.documentElement.dir = UI_LANG === 'ar' ? 'rtl' : 'ltr';
  document.body.dataset.drop = t('Drop to add to your library');
  Object.assign($('lang'), UI_LANG === 'ar' ? { textContent: 'English', lang: 'en' } : { textContent: 'العربية', lang: 'ar' });
  if (UI_LANG !== 'ar') return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const key = node.nodeValue.trim();
    if (AR[key]) node.nodeValue = node.nodeValue.replace(key, AR[key]);
  }
  for (const el of document.querySelectorAll('[aria-label], [placeholder]')) {
    for (const attr of ['aria-label', 'placeholder']) if (AR[el.getAttribute(attr)]) el.setAttribute(attr, AR[el.getAttribute(attr)]);
  }
}
// Search ignores case, Latin accents, Arabic diacritics/tatweel and common letter variants (أ/إ/آ → ا, ى → ي, ة → ه).
const fold = s => s.normalize('NFKD').replace(/[\p{M}\u0640]/gu, '').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();

// --- storage: book files in `books`, reading position in `state` (so scrolling never rewrites the book blobs)
const db = new Promise((resolve, reject) => {
  const req = indexedDB.open('shelf', 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore('books', { keyPath: 'id' });
    req.result.createObjectStore('state', { keyPath: 'id' });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function store(name, mode, fn) {
  const tx = (await db).transaction(name, mode);
  const req = fn(tx.objectStore(name));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// --- boko (wasm) in a worker
let worker, seq = 0;
const pending = new Map();
function boko(op, bytes, from, to) {
  if (!worker) {
    worker = new Worker('worker.js', { type: 'module' });
    worker.onmessage = ({ data: { id, result, error } }) => {
      const job = pending.get(id);
      pending.delete(id);
      error ? job.reject(new Error(error)) : job.resolve(result);
      // A Rust panic can leave the wasm instance in a bad state: start fresh next time.
      if (error && /unreachable|RuntimeError/.test(error)) restart();
    };
    worker.onerror = e => { e.preventDefault(); restart(e.message || t('the converter crashed')); };
  }
  return new Promise((resolve, reject) => {
    pending.set(++seq, { resolve, reject });
    worker.postMessage({ id: seq, op, bytes, from, to });
  });
}
function restart(reason) {
  worker.terminate();
  worker = null;
  for (const job of pending.values()) job.reject(new Error(reason));
  pending.clear();
}

// --- library
let books = [];
const covers = new Map();

function coverEl(book) {
  if (book.cover) {
    if (!covers.has(book.id)) covers.set(book.id, URL.createObjectURL(book.cover));
    return Object.assign(new Image(), { className: 'cover', alt: '', loading: 'lazy', src: covers.get(book.id) });
  }
  const el = Object.assign(document.createElement('span'), { className: 'cover placeholder', textContent: book.title, dir: 'auto' });
  const hue = [...book.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
  el.style.background = `hsl(${hue} 30% 34%)`;
  return el;
}

const span = (className, textContent) => Object.assign(document.createElement('span'), { className, textContent, dir: 'auto' });
const authors = book => book.authors.join(', ') || t('Unknown author');

function render() {
  const q = fold($('q').value.trim());
  books.sort((a, b) => (b.state?.opened ?? b.added) - (a.state?.opened ?? a.added));
  $('grid').replaceChildren(...books
    .filter(b => !q || fold(`${b.title} ${b.authors.join(' ')}`).includes(q))
    .map(b => {
      const card = Object.assign(document.createElement('button'), { className: 'card', onclick: () => showDetails(b) });
      card.append(coverEl(b), span('t', b.title), span('a', authors(b)), span('badge', b.format.toUpperCase()));
      return card;
    }));
  $('empty').hidden = books.length > 0;
  $('q').hidden = books.length === 0;
}

async function importFiles(files) {
  files = [...files];
  if (!files.length) return;
  navigator.storage?.persist?.();
  const problems = [];
  let added = 0;
  for (const [n, file] of files.entries()) {
    const format = INPUTS[file.name.split('.').pop().toLowerCase()];
    if (!format) { problems.push(t('{name}: not an EPUB, KFX, AZW3 or MOBI file', { name: file.name })); continue; }
    if (books.some(b => b.name === file.name && b.size === file.size)) { problems.push(t('{name}: already in your library', { name: file.name })); continue; }
    say(`${files.length > 1 ? `(${n + 1}/${files.length}) ` : ''}${t('Adding {name}…', { name: file.name })}`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = await boko('info', bytes, format);
      // The reader only speaks EPUB, so boko converts everything else once, up front.
      const epub = format === 'epub' ? null
        : new Blob([await boko('convert', bytes, format, 'epub')], { type: OUTPUTS.epub[2] });
      const cover = await openEpub(epub ?? file).then(async e => { const c = await e.cover(); e.close(); return c; }).catch(() => null);
      const book = {
        id: crypto.randomUUID(), name: file.name, size: file.size, format, added: Date.now(),
        title: info.title || baseName(file.name), authors: info.authors, language: info.language, chapters: info.chapters,
        file, epub, cover,
      };
      await store('books', 'readwrite', s => s.put(book));
      books.push(book);
      added++;
      render();
    } catch (e) {
      problems.push(`${file.name}: ${e.message}`);
    }
  }
  say([added && (added === 1 ? t('Added 1 book.') : t('Added {n} books.', { n: added })),
    ...problems.map(problem => t("Couldn't add {problem}.", { problem }))].filter(Boolean).join(' '));
}

// --- details dialog
let current;
function showDetails(book) {
  current = book;
  $('d-cover').replaceChildren(coverEl(book));
  $('d-title').textContent = book.title;
  $('d-authors').textContent = authors(book);
  $('d-meta').textContent = [book.format.toUpperCase(), fmtSize(book.size), book.language, t('{n} chapters', { n: book.chapters }),
    t('added {date}', { date: new Date(book.added).toLocaleDateString(LOCALE) })].filter(Boolean).join(' · ');
  $('d-msg').textContent = '';
  const last = pref('convertTo', 'kfx');
  $('d-format').replaceChildren(...Object.entries(OUTPUTS).filter(([k]) => k !== book.format)
    .map(([k, [label]]) => new Option(label, k, false, k === last)));
  $('details').showModal();
}

async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  $('d-msg').textContent = '';
  try { await fn(); } catch (e) { $('d-msg').textContent = e.message; } finally { btn.disabled = false; btn.textContent = old; }
}

function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

$('d-convert').onclick = () => busy($('d-convert'), t('Converting…'), async () => {
  const book = current, to = $('d-format').value, [, ext, type] = OUTPUTS[to];
  setPref('convertTo', to);
  const out = await boko('convert', new Uint8Array(await book.file.arrayBuffer()), book.format, to);
  download(new Blob([out], { type }), `${baseName(book.name)}.${ext}`);
  $('d-msg').textContent = t('Saved {name} ({size}).', { name: `${baseName(book.name)}.${ext}`, size: fmtSize(out.length) });
});
$('d-original').onclick = () => download(current.file, current.name);
$('d-read').onclick = () => { $('details').close(); openReader(current); };
$('d-delete').onclick = async () => {
  const book = current;
  if (!confirm(t('Remove “{title}” from your library? The file is deleted from this device.', { title: book.title }))) return;
  await store('books', 'readwrite', s => s.delete(book.id));
  await store('state', 'readwrite', s => s.delete(book.id));
  URL.revokeObjectURL(covers.get(book.id));
  covers.delete(book.id);
  books = books.filter(b => b !== book);
  $('details').close();
  render();
};

// --- reader
const frame = $('r-frame');
const THEMES = { light: ['#fffdf8', '#24201b'], sepia: ['#f3ead7', '#3f3121'], dark: ['#171513', '#dcd3c6'] };
const prefs = pref('reader', { size: 100, theme: 'auto' });
let R = null; // { book, epub, i, style }
let scrollTimer;

async function openReader(book) {
  say(t('Opening {title}…', { title: book.title }));
  try {
    R = { book, epub: await openEpub(book.epub ?? book.file), i: -1 };
  } catch (e) {
    say(t("Couldn't open {title}: {error}", { title: book.title, error: e.message }));
    return;
  }
  say('');
  const { toc, dir } = R.epub;
  // The footer (page turns, progress) and TOC follow the book's direction; the header follows the UI's.
  $('r-bottom').dir = $('r-toc').dir = dir;
  $('r-toc').replaceChildren(Object.assign(new Option(t('Contents'), -1), { hidden: true }),
    ...toc.map((t, k) => new Option('   '.repeat(t.depth) + t.label, k)));
  $('r-toc').hidden = !toc.length;
  $('reader').hidden = false;
  document.title = book.title;
  history.pushState({ reader: true }, '');
  applyTheme();
  await go(book.state?.i ?? 0, { frac: book.state?.frac ?? 0 });
}

function closeReader() {
  clearTimeout(scrollTimer);
  $('reader').hidden = true;
  const { epub } = R;
  frame.onload = () => epub.close(); // revoke blob URLs only once the old chapter is gone
  frame.contentWindow.location.replace('about:blank');
  R = null;
  document.title = 'Shelf';
  render();
}

async function go(i, { frac = 0, frag = '' } = {}) {
  const r = R, n = r.epub.spine.length;
  i = Math.max(0, Math.min(n - 1, i));
  try {
    if (i !== r.i) {
      frame.style.visibility = 'hidden';
      const url = await r.epub.chapter(i);
      // replace() so chapter changes don't pile up in history: Back always means "close the book".
      await new Promise(done => { frame.onload = done; frame.contentWindow.location.replace(url); });
      if (R !== r) return;
      r.i = i;
      setupChapter(frame.contentDocument);
      frame.style.visibility = '';
    }
    const win = frame.contentWindow, target = frag && win.document.getElementById(frag);
    if (target) target.scrollIntoView();
    else win.scrollTo(0, frac * (win.document.documentElement.scrollHeight - win.innerHeight));
    savePosition();
  } catch (e) {
    frame.style.visibility = '';
    $('r-pos').textContent = t("Couldn't show this chapter: {error}", { error: e.message });
  }
}

// The frame is sandboxed with allow-scripts only because WebKit drops parent-attached event
// listeners otherwise; book scripts are still stripped and blocked by the CSP epub.js injects.
function setupChapter(doc) {
  R.style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
  (doc.head ?? doc.documentElement).append(R.style);
  applyTheme();
  doc.addEventListener('click', onLinkClick);
  doc.addEventListener('keydown', onKey);
  frame.contentWindow.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(savePosition, 300);
  }, { passive: true });
}

function applyTheme() {
  const name = prefs.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : prefs.theme;
  const [bg, fg] = THEMES[name];
  $('reader').style.setProperty('--rbg', bg);
  $('reader').style.setProperty('--rfg', fg);
  $('r-theme').value = prefs.theme;
  setPref('reader', prefs);
  if (!R?.style) return;
  R.style.textContent = `
    html { font-size: ${prefs.size}% !important; color-scheme: ${name === 'dark' ? 'dark' : 'light'}; }
    html, body { background: ${bg} !important; color: ${fg} !important; }
    body { max-width: 38em; margin: 0 auto !important; padding: 1.5em 1.25em 4em !important; line-height: 1.6; }
    :root:is(:lang(ar), :lang(fa), :lang(ur), :lang(ps), :lang(sd), :lang(ckb), :lang(ug)) body { line-height: 1.9; }
    img, svg, video { max-width: 100%; max-height: 92vh; height: auto; object-fit: contain; }
    ${name === 'light' ? '' : `body *:not(a) { color: inherit !important; } a { color: ${fg} !important; }`}`;
}

function savePosition() {
  if (!R || R.i < 0) return;
  const win = frame.contentWindow, n = R.epub.spine.length;
  const max = win.document.documentElement.scrollHeight - win.innerHeight;
  const frac = max > 0 ? win.scrollY / max : 0;
  $('r-pos').textContent = `${R.i + 1} / ${n}`;
  $('r-bar').style.width = `${((R.i + (max > 0 ? frac : 1)) / n) * 100}%`;
  $('r-prev').disabled = R.i === 0;
  $('r-next').disabled = R.i === n - 1;
  // Current TOC entry: the last one that starts before this point (top third of the screen).
  let k = -1;
  R.epub.toc.forEach((t, j) => {
    const at = R.epub.indexOf(t.path), el = at === R.i && t.frag && win.document.getElementById(t.frag);
    if (at >= 0 && at <= R.i && (!el || el.getBoundingClientRect().top < win.innerHeight / 3)) k = j;
  });
  $('r-toc').value = k;
  R.book.state = { id: R.book.id, i: R.i, frac, opened: Date.now() };
  store('state', 'readwrite', s => s.put(R.book.state)).catch(() => {});
}

function onLinkClick(e) {
  const a = e.target.closest?.('a[href]');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (/^(https?|mailto):/i.test(href)) return void window.open(href, '_blank', 'noopener');
  if (R.epub.isExternal(href) && !href.startsWith('#')) return; // javascript:, file:, etc.
  const i = R.epub.indexOf(R.epub.resolve(R.epub.spine[R.i].path, href));
  if (i >= 0) go(i, { frag: R.epub.fragment(href) });
}

function onKey(e) {
  if (!R || e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const [back, forward] = R.epub.dir === 'rtl' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowLeft', 'ArrowRight'];
  if (e.key === forward) go(R.i + 1);
  else if (e.key === back) go(R.i - 1);
  else if (e.key === 'Escape') history.back();
  else return;
  e.preventDefault();
}

$('r-back').onclick = () => history.back();
$('r-prev').onclick = () => go(R.i - 1);
$('r-next').onclick = () => go(R.i + 1);
$('r-toc').onchange = () => {
  const t = R.epub.toc[$('r-toc').value], i = t && R.epub.indexOf(t.path);
  if (i >= 0) go(i, { frag: t.frag });
};
$('r-smaller').onclick = () => { prefs.size = Math.max(60, prefs.size - 10); applyTheme(); };
$('r-bigger').onclick = () => { prefs.size = Math.min(220, prefs.size + 10); applyTheme(); };
$('r-theme').onchange = () => { prefs.theme = $('r-theme').value; applyTheme(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
addEventListener('popstate', () => R && closeReader());
document.addEventListener('keydown', e => R && onKey(e));

// --- adding books: button, drag & drop anywhere, or "Open with" once installed
$('add').onclick = $('add2').onclick = () => $('pick').click();
$('lang').onclick = () => { setPref('lang', UI_LANG === 'ar' ? 'en' : 'ar'); location.reload(); };
$('pick').onchange = () => { importFiles($('pick').files).then(() => { $('pick').value = ''; }); };
$('q').oninput = render;
let dragDepth = 0;
const dragging = on => document.body.classList.toggle('dragging', on);
addEventListener('dragenter', e => { if (!R && e.dataTransfer.types.includes('Files')) { dragDepth++; dragging(true); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dragging(false); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; dragging(false); if (!R) importFiles(e.dataTransfer.files); });
window.launchQueue?.setConsumer(async ({ files }) => importFiles(await Promise.all(files.map(f => f.getFile()))));

navigator.serviceWorker?.register('sw.js');

translatePage();
try {
  const [all, states] = await Promise.all([
    store('books', 'readonly', s => s.getAll()),
    store('state', 'readonly', s => s.getAll()),
  ]);
  const byId = new Map(states.map(s => [s.id, s]));
  books = all.map(b => ({ ...b, state: byId.get(b.id) }));
} catch (e) {
  say(t("Can't open local storage, so books won't be saved: {error}", { error: e.message }));
}
render();

// Analytics and session replay (Siraaj), on the production site only. Books stay out of recordings:
// every chapter document has `siraaj-block` (set in epub.js), so does the file picker, and book-derived
// text (library, details, status, TOC, <title>) has `siraaj-mask`. The SDK masks other inputs itself.
const SIRAAJ = 'https://analytics.hefni101.dev';
if (location.hostname === 'ebook.hefni101.dev') {
  const load = src => new Promise((resolve, reject) =>
    document.head.append(Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject })));
  // analytics.min.js, not analytics.umd.min.js: only that build has the replayTarget() replay needs.
  Promise.all([load(`${SIRAAJ}/sdk/analytics.min.js`), load(`${SIRAAJ}/sdk/replay.min.js`)]).then(() => {
    const { analytics } = window.SiraajAnalytics;
    // The token is a project-scoped, write-only key (public by design; revocable in the dashboard).
    // The server takes the project from it, so projectId is only a label.
    analytics.init({ apiUrl: SIRAAJ, projectId: 'ebook', trackingToken: 'siraaj_trk_seXIOSrkuAWnT3oeLdGtEHg28BMDaAq3olngl6X4GAk', autoTrack: true });
    window.SiraajReplay.startReplay(analytics);
  }).catch(() => {}); // offline or blocked: the app works the same without analytics
}
