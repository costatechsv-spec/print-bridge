'use strict';

// The tables tried by default, with the ESC t number most printers use.
const DEFAULT_TABLES = [
  { name: 'cp437', number: 0 },
  { name: 'cp850', number: 2 },
  { name: 'wpc1252', number: 16 },
  { name: 'cp858', number: 19 },
];

const SAMPLE = 'á é í ó ú  Á É Í Ó Ú  ñ Ñ ü  ¿ ¡  €';

// A sheet for setting up a new printer: text styles, line width, and one
// block per code table. Each block prints a sample line encoded for that
// table -- the block whose sample comes out right names the table and number
// to configure -- followed by the raw bytes 0x80-0xFF as the printer holds
// them under that number, for identifying an unknown table.
function testSheet({ width = 48, tables = DEFAULT_TABLES, title = 'PRINTER TEST' } = {}) {
  const { EscPos } = require('./index');
  const job = new EscPos({ width, codeTable: 'cp437', codeTableNumber: 0 });

  job.align('center').bold().size(2, 2).text(title).size(1, 1).bold(false);
  job.text(`${width} columns`).align('left').rule('=');

  job.text('123456789012345678901234567890123456789012345678'.slice(0, width));
  job.text('Normal').bold().text('Bold').bold(false);
  job.underline().text('Underline').underline(false);
  job.size(2, 1).text('Double width').size(1, 2).text('Double height').size(2, 2).text('Double').size(1, 1);
  job.align('center').text('Centered').align('right').text('Right').align('left');
  job.leftRight('Left and right', '$12.50');
  job.text('Wrapped: a long line of words that does not fit on one line wraps to the next one.', { indent: 9 });
  job.rule();

  for (const t of tables) {
    job.codeTable('cp437', 0).bold().text(`ESC t ${t.number} = ${t.name}?`).bold(false);
    job.codeTable(t.name, t.number).text(SAMPLE);
    for (let row = 0x80; row < 0x100; row += 0x10) {
      const bytes = [];
      for (let b = row; b < row + 0x10; b++) bytes.push(b, 0x20);
      job.raw([...Buffer.from(`${row.toString(16).toUpperCase()}: `), ...bytes, 0x0a]);
    }
    job.rule();
  }

  job.codeTable('cp437', 0).text('The paper should be cut below this line.').cut();
  return job;
}

module.exports = { testSheet, DEFAULT_TABLES };
