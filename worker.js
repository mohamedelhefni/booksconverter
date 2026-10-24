// Runs boko off the main thread so big conversions don't freeze the UI.
import init, { convert, book_info } from './pkg/boko.js';

const ready = init();

onmessage = async ({ data: { id, op, bytes, from, to } }) => {
  try {
    await ready;
    const result = op === 'info' ? JSON.parse(book_info(bytes, from)) : convert(bytes, from, to);
    postMessage({ id, result }, result instanceof Uint8Array ? [result.buffer] : []);
  } catch (e) {
    postMessage({ id, error: String(e?.message ?? e) });
  }
};
