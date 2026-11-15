'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EscPos, CodeTable, wrap, testSheet, CODE_TABLES } = require('../src');

const HEADER = (n) => [0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, n];
const bytes = (job) => [...job.toBytes()];
const body = (job) => bytes(job).slice(7);
const hex = (arr) => arr.map((b) => b.toString(16).padStart(2, '0')).join(' ');

test('every job starts with reset, Chinese mode off and the code table', () => {
  assert.deepEqual(bytes(new EscPos()), HEADER(19));
  assert.deepEqual(bytes(new EscPos({ codeTable: 'wpc1252' })), HEADER(16));
  assert.deepEqual(bytes(new EscPos({ codeTable: 'cp858', codeTableNumber: 7 })), HEADER(7));
});

test('Spanish in cp858 lands on the right bytes', () => {
  const t = new CodeTable('cp858');
  const expected = {
    á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9,
    ñ: 0xa4, Ñ: 0xa5, ü: 0x81, '¿': 0xa8, '¡': 0xad, '€': 0xd5, '×': 0x9e, '»': 0xaf, '·': 0xfa,
  };
  for (const [c, b] of Object.entries(expected)) {
    const { text, replaced } = t.prepare(c);
    assert.deepEqual(replaced, [], c);
    assert.deepEqual(t.encode(text), [b], c);
  }
});

test('wpc1252 matches the platform windows-1252 decoder', () => {
  const t = new CodeTable('wpc1252');
  const decoder = new TextDecoder('windows-1252');
  for (let b = 0xa0; b <= 0xff; b++) {
    const c = decoder.decode(Uint8Array.of(b));
    assert.deepEqual(t.encode(t.prepare(c).text), [b], `byte ${b.toString(16)}`);
  }
  assert.deepEqual(t.encode(t.prepare('€').text), [0x80]);
});

test('every table maps its characters to distinct bytes and back', () => {
  for (const name of CODE_TABLES) {
    const t = new CodeTable(name);
    assert.ok(t.bytes.size >= 120, `${name} has ${t.bytes.size} characters`);
    assert.equal(new Set(t.bytes.values()).size, t.bytes.size, name);
  }
});

test('characters a table lacks fall back to something readable', () => {
  const t = new CodeTable('cp437');
  // cp437 has é and É but no Á, Í, Ó, Ú or €.
  assert.equal(t.prepare('Á É Í Ó Ú').text, 'A É I O U');
  assert.equal(t.prepare('Precio: 5 €').text, 'Precio: 5 EUR');
  assert.equal(t.prepare('“hola” – adiós…').text, '"hola" - adiós...');
  const emoji = t.prepare('Hamburguesa 🍔 ok');
  assert.equal(emoji.text, 'Hamburguesa ? ok');
  assert.deepEqual(emoji.replaced, ['🍔']);
  // Emoji with a variation selector still count once.
  assert.equal(t.prepare('❤️').text, '?');
});

test('decomposed accents are composed before encoding', () => {
  const t = new CodeTable('cp858');
  assert.deepEqual(t.encode(t.prepare('á').text), [0xa0]);
});

test('control characters in text cannot inject printer commands', () => {
  const job = new EscPos().text('a\x1b@b\x1d\x56\x00c');
  assert.deepEqual(body(job), [...Buffer.from('a@bVc'), 0x0a]);
});

test('style commands', () => {
  assert.deepEqual(body(new EscPos().bold()), [0x1b, 0x45, 1]);
  assert.deepEqual(body(new EscPos().bold(false)), [0x1b, 0x45, 0]);
  assert.deepEqual(body(new EscPos().underline()), [0x1b, 0x2d, 1]);
  assert.deepEqual(body(new EscPos().align('center')), [0x1b, 0x61, 1]);
  assert.deepEqual(body(new EscPos().align('right')), [0x1b, 0x61, 2]);
  assert.deepEqual(body(new EscPos().size(2, 2)), [0x1d, 0x21, 0x11]);
  assert.deepEqual(body(new EscPos().size(2, 1)), [0x1d, 0x21, 0x10]);
  assert.deepEqual(body(new EscPos().size(1, 1)), [0x1d, 0x21, 0x00]);
  assert.deepEqual(body(new EscPos().feed(3)), [0x1b, 0x64, 3]);
  assert.deepEqual(body(new EscPos().cut()), [0x1b, 0x64, 4, 0x1d, 0x56, 0]);
  assert.deepEqual(body(new EscPos().cut({ partial: true, feed: 0 })), [0x1b, 0x64, 0, 0x1d, 0x56, 1]);
  assert.throws(() => new EscPos().align('middle'));
  assert.throws(() => new EscPos().size(9, 1));
  assert.throws(() => new EscPos({ codeTable: 'cp999' }));
  assert.throws(() => new EscPos().raw([256]));
});

test('text is encoded with the current table and ends each line', () => {
  const job = new EscPos({ codeTable: 'cp858' }).text('Aquí');
  assert.equal(hex(body(job)), '41 71 75 a1 0a');
});

test('wrap keeps lines within the width', () => {
  const text = 'Hamburguesa clásica con queso cheddar, tocino, cebolla caramelizada y salsa de la casa';
  const lines = wrap(text, 20);
  assert.ok(lines.every((l) => l.length <= 20), lines.join('|'));
  assert.equal(lines.join(' '), text);
  assert.deepEqual(wrap('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrap('uno\n\ndos', 10), ['uno', '', 'dos']);
  assert.deepEqual(wrap('2x Hamburguesa con queso', 14, 3), ['2x Hamburguesa', '   con queso']);
});

test('double width halves the columns text wraps at', () => {
  const job = new EscPos({ width: 48 }).size(2, 2);
  assert.equal(job.columns, 24);
  job.text('x'.repeat(30));
  const lines = Buffer.from(body(job).slice(3)).toString('latin1').split('\n');
  assert.deepEqual(lines.map((l) => l.length), [24, 6, 0]);
});

test('leftRight pads to the full width and wraps a long left side', () => {
  const one = new EscPos({ width: 20 }).leftRight('Total', '$4.50');
  assert.equal(Buffer.from(body(one)).toString('latin1'), 'Total          $4.50\n');
  const two = new EscPos({ width: 20 }).leftRight('Hamburguesa doble con queso', '$9.00');
  const lines = Buffer.from(body(two)).toString('latin1').split('\n');
  assert.ok(lines.every((l) => l.length <= 20), lines.join('|'));
  assert.ok(lines[lines.length - 2].endsWith('$9.00'));
});

test('rule fills the line', () => {
  assert.equal(Buffer.from(body(new EscPos({ width: 10 }).rule())).toString('latin1'), '----------\n');
});

test('replaced characters are reported', () => {
  const job = new EscPos({ codeTable: 'cp858' }).text('Café 🍔').text('Té 🍔 ☕');
  assert.deepEqual(job.replaced, ['🍔', '☕']);
});

test('base64 round-trips the bytes', () => {
  const job = new EscPos().text('Comanda #12').cut();
  assert.deepEqual([...Buffer.from(job.toBase64(), 'base64')], bytes(job));
});

test('the test sheet selects each table and cuts', () => {
  const sheet = hex(bytes(testSheet()));
  for (const n of [0, 2, 16, 19]) assert.ok(sheet.includes(`1b 74 ${n.toString(16).padStart(2, '0')}`), `ESC t ${n}`);
  assert.ok(sheet.endsWith('1d 56 00'));
  const custom = hex(bytes(testSheet({ tables: [{ name: 'cp858', number: 5 }] })));
  assert.ok(custom.includes('1b 74 05'));
});
