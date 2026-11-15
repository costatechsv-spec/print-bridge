'use strict';

const { CodeTable, CODE_TABLES, DEFAULT_NUMBERS } = require('./codepages');
const { wrap } = require('./wrap');

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;
const ALIGN = { left: 0, center: 1, right: 2 };

// Builds the bytes of one ESC/POS print job. Calls chain:
//
//   const job = new EscPos({ width: 48, codeTable: 'cp858' })
//     .align('center').size(2, 2).text('NUEVA ORDEN')
//     .size(1, 1).align('left').text('2x Hamburguesa')
//     .cut();
//   send(job.toBytes());
//
// Every job starts by resetting the printer, turning off Chinese (multi-byte)
// mode -- which many generic printers start in and which turns accented
// letters into Chinese characters -- and selecting the code table.
class EscPos {
  constructor({ width = 48, codeTable = 'cp858', codeTableNumber } = {}) {
    if (!Number.isInteger(width) || width < 8) throw new Error(`Width must be at least 8, got ${width}`);
    this.width = width;
    this.out = [];
    this.replacedChars = new Set();
    this.widthScale = 1;
    this.raw([ESC, 0x40]); // ESC @: reset
    this.raw([FS, 0x2e]); // FS .: Chinese mode off
    this.codeTable(codeTable, codeTableNumber);
  }

  // Switches the character table for the text that follows (ESC t n).
  codeTable(name, number) {
    this.table = new CodeTable(name, number);
    return this.raw([ESC, 0x74, this.table.number]);
  }

  align(where) {
    if (!(where in ALIGN)) throw new Error(`Align must be left, center or right, got ${where}`);
    return this.raw([ESC, 0x61, ALIGN[where]]);
  }

  bold(on = true) {
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }

  underline(on = true) {
    return this.raw([ESC, 0x2d, on ? 1 : 0]);
  }

  // Character size as width and height multipliers, 1-8 (GS !). Wider text
  // fits fewer characters on a line; text() wraps accordingly.
  size(width = 1, height = 1) {
    for (const v of [width, height]) {
      if (!Number.isInteger(v) || v < 1 || v > 8) throw new Error(`Size must be 1-8, got ${v}`);
    }
    this.widthScale = width;
    return this.raw([GS, 0x21, ((width - 1) << 4) | (height - 1)]);
  }

  // Characters that fit on one line at the current size.
  get columns() {
    return Math.floor(this.width / this.widthScale);
  }

  // Prints text, wrapped to the line, ending with a line break. `indent`
  // starts continuation lines with that many spaces.
  text(value = '', { indent = 0 } = {}) {
    const prepared = this.printable(value);
    for (const line of wrap(prepared, this.columns, indent)) {
      this.raw(this.table.encode(line));
      this.raw([0x0a]);
    }
    return this;
  }

  // One line with `left` at the start and `right` at the end ("Total  $4.50").
  // A left side too long to share the line wraps above it.
  leftRight(left, right) {
    const r = this.printable(right);
    const room = this.columns - r.length - 1;
    const lines = room > 0 ? wrap(this.printable(left), room) : [this.printable(left), ''];
    const last = lines.pop();
    for (const line of lines) this.raw(this.table.encode(line)).raw([0x0a]);
    const gap = Math.max(this.columns - last.length - r.length, 1);
    return this.raw(this.table.encode(last + ' '.repeat(gap) + r)).raw([0x0a]);
  }

  // A full-width line of one character, e.g. a dashed separator.
  rule(char = '-') {
    const c = this.printable(char)[0] ?? '-';
    return this.raw(this.table.encode(c.repeat(this.columns))).raw([0x0a]);
  }

  // Feeds n blank lines (ESC d n).
  feed(lines = 1) {
    if (!Number.isInteger(lines) || lines < 0 || lines > 255) throw new Error(`Feed must be 0-255, got ${lines}`);
    return this.raw([ESC, 0x64, lines]);
  }

  // Feeds the paper past the cutter, then cuts (GS V). Printers without a
  // cutter ignore it.
  cut({ partial = false, feed = 4 } = {}) {
    return this.feed(feed).raw([GS, 0x56, partial ? 1 : 0]);
  }

  // Appends bytes as they are, for commands this class doesn't cover.
  raw(bytes) {
    for (const b of bytes) {
      if (!Number.isInteger(b) || b < 0 || b > 255) throw new Error(`Not a byte: ${b}`);
      this.out.push(b);
    }
    return this;
  }

  // Characters that couldn't be printed and came out as "?".
  get replaced() {
    return [...this.replacedChars];
  }

  toBytes() {
    return Uint8Array.from(this.out);
  }

  toBase64() {
    return Buffer.from(this.out).toString('base64');
  }

  printable(value) {
    const { text, replaced } = this.table.prepare(value);
    for (const c of replaced) this.replacedChars.add(c);
    return text;
  }
}

module.exports = { EscPos, CodeTable, wrap, CODE_TABLES, DEFAULT_NUMBERS };
module.exports.testSheet = require('./test-sheet').testSheet;
