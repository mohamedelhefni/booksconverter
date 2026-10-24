// Smoke check: boko wasm reads every input format, writes every output format,
// and our ZIP reader can open the EPUB it produces. Run after ./build.sh: `bun check.mjs` (or node).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initSync, convert, book_info } from './pkg/boko.js';
import { unzip, inflate } from './epub.js';

initSync({ module: readFileSync(new URL('./pkg/boko_bg.wasm', import.meta.url)) });
const fixture = name => readFileSync(new URL(`./.boko/tests/fixtures/${name}`, import.meta.url));

for (const from of ['epub', 'azw3', 'mobi', 'kfx']) {
  const bytes = fixture(`epictetus.${from}`);
  const info = JSON.parse(book_info(bytes, from));
  assert.match(info.title, /Short Works/, `${from} title: ${info.title}`);
  for (const to of ['epub', 'azw3', 'kfx', 'markdown']) assert.ok(convert(bytes, from, to).length > 1000, `${from} -> ${to}`);

  const zip = await unzip(new Blob([convert(bytes, from, 'epub')]));
  const container = new TextDecoder().decode(await inflate(zip.get('META-INF/container.xml')));
  const opf = container.match(/full-path="([^"]+)"/)[1];
  assert.match(new TextDecoder().decode(await inflate(zip.get(opf))), /<spine/, `${from} -> epub has a spine`);
  console.log(`ok ${from}: "${info.title}" by ${info.authors.join(', ')}, ${info.chapters} chapters`);
}
assert.throws(() => convert(new Uint8Array([1, 2, 3]), 'epub', 'kfx'));
console.log('ok garbage input is rejected');

// RTL (patches/boko-rtl.patch): direction survives KFX and AZW3 round trips.
const rtl = readFileSync(new URL('./fixtures/rtl.epub', import.meta.url));
assert.equal(JSON.parse(book_info(rtl, 'epub')).language, 'ar');
for (const via of ['kfx', 'azw3']) {
  const zip = await unzip(new Blob([convert(convert(rtl, 'epub', via), via, 'epub')]));
  let text = '';
  for (const [name, entry] of zip) if (/\.(opf|x?html|css)$/.test(name)) text += new TextDecoder().decode(await inflate(entry));
  assert.match(text, /page-progression-direction="rtl"/, `${via}: page direction`);
  assert.match(text, /<html[^>]*dir="rtl"/, `${via}: chapter direction`);
  assert.match(text, /direction: ltr|dir="ltr"/, `${via}: the English paragraph stays LTR`);
  console.log(`ok rtl survives epub -> ${via} -> epub`);
}
