'use strict';

// Splits text into lines of at most `width` characters, breaking at spaces
// and cutting words longer than a line. Existing line breaks are kept.
// Continuation lines start with `indent` spaces, so a wrapped item lines up
// under its own text ("2x Hamburguesa con..." / "   queso").
function wrap(text, width, indent = 0) {
  if (!Number.isInteger(width) || width < 1) throw new Error(`Width must be at least 1, got ${width}`);
  const pad = ' '.repeat(Math.min(Math.max(indent, 0), width - 1));
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.split(' ').filter((w) => w !== '');
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    let empty = true;
    for (let word of words) {
      if (!empty && line.length + 1 + word.length <= width) {
        line += ' ' + word;
        continue;
      }
      if (!empty) {
        lines.push(line);
        line = pad;
      }
      while (line.length + word.length > width) {
        const room = width - line.length;
        lines.push(line + word.slice(0, room));
        word = word.slice(room);
        line = pad;
      }
      line += word;
      empty = false;
    }
    lines.push(line);
  }
  return lines;
}

module.exports = { wrap };
