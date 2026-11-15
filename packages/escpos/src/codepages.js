'use strict';

const TABLES = require('./tables');

// The ESC t number most printers use for each table. Numbering varies by
// maker, so a printer that differs can be given its own number.
const DEFAULT_NUMBERS = { cp437: 0, cp850: 2, wpc1252: 16, cp858: 19 };

// Plain stand-ins for characters a table lacks, tried before giving up.
const FALLBACKS = {
  '‘': "'", // ‘
  '’': "'", // ’
  '‚': ',', // ‚
  '“': '"', // “
  '”': '"', // ”
  '„': '"', // „
  '–': '-', // –
  '—': '-', // —
  '…': '...', // …
  '•': '*', // •
  '×': 'x', // ×
  '«': '<<', // «
  '»': '>>', // »
  '·': '.', // ·
  '€': 'EUR', // €
  ' ': ' ', // no-break space
  '\t': ' ',
};

// Invisible joiners and emoji variation selectors: dropped without a trace.
const IGNORED = new Set(['​', '‌', '‍', '︎', '️']);

const COMBINING_MARKS = /[̀-ͯ]/g;

// One printer character table: which characters it can print and the byte
// for each. Text goes through prepare() (make it printable, so wrapping can
// count columns) and then encode() (characters to bytes).
class CodeTable {
  constructor(name, number) {
    const chars = TABLES[name];
    if (!chars) {
      throw new Error(`Unknown code table "${name}" (known: ${Object.keys(TABLES).join(', ')})`);
    }
    const n = number ?? DEFAULT_NUMBERS[name];
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new Error(`Code table number must be 0-255, got ${number}`);
    }
    this.name = name;
    this.number = n;
    this.bytes = new Map();
    chars.forEach((c, i) => {
      if (c !== null && !this.bytes.has(c)) this.bytes.set(c, 0x80 + i);
    });
  }

  canPrint(c) {
    return (c >= ' ' && c <= '~') || c === '\n' || this.bytes.has(c);
  }

  // Returns text made only of characters this table can print, plus the
  // characters that had to be replaced. Control characters are removed, so
  // text can never smuggle printer commands in.
  prepare(text) {
    let out = '';
    const replaced = [];
    for (const c of String(text).normalize('NFC')) {
      if (this.canPrint(c)) {
        out += c;
        continue;
      }
      if (IGNORED.has(c) || c < ' ' || c === '\x7f' || (c >= '\x80' && c <= '\x9f')) {
        continue;
      }
      const fallback = FALLBACKS[c];
      if (fallback !== undefined && [...fallback].every((f) => this.canPrint(f))) {
        out += fallback;
        continue;
      }
      // Á in a table without it prints as A; ŝ as s.
      const base = c.normalize('NFD').replace(COMBINING_MARKS, '');
      if (base && base !== c && [...base].every((b) => this.canPrint(b))) {
        out += base;
        continue;
      }
      out += '?';
      replaced.push(c);
    }
    return { text: out, replaced };
  }

  // Bytes for text already passed through prepare().
  encode(text) {
    const out = [];
    for (const c of text) {
      out.push(c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : this.bytes.get(c));
    }
    return out;
  }
}

module.exports = { CodeTable, DEFAULT_NUMBERS, CODE_TABLES: Object.keys(TABLES) };
