# @costatechsv-spec/escpos

A small ESC/POS builder for 58/80 mm receipt and kitchen printers. Plain
JavaScript, no dependencies, Node 18+.

```js
const { EscPos } = require('@costatechsv-spec/escpos');

const job = new EscPos({ width: 48, codeTable: 'cp858' })
  .align('center').bold().size(2, 2).text('NUEVA ORDEN')
  .size(1, 1).bold(false).align('left')
  .leftRight('Orden #12 · Mesa 4', '10:32')
  .rule()
  .text('2x Hamburguesa clásica con queso y tocino', { indent: 3 })
  .text('   » sin cebolla')
  .cut();

job.toBytes();   // Uint8Array, ready to send to the printer (e.g. TCP port 9100)
job.toBase64();  // the same bytes as base64
job.replaced;    // characters that couldn't be printed and came out as "?"
```

## What it does

- **Every job starts clean**: `ESC @` (reset), `FS .` (Chinese mode off: many
  generic printers start in it, which turns accented letters into Chinese
  characters) and `ESC t n` (code table).
- **Styles**: `bold()`, `underline()`, `size(w, h)` (1–8), `align('left' | 'center' | 'right')`.
- **Layout**: `text()` wraps at the line width (`width / size width`), with an
  optional hanging `indent`; `leftRight()` for "item ... price"; `rule()`.
- **Paper**: `feed(n)`, `cut({ partial, feed })`.
- **Escape hatch**: `raw(bytes)`.

## Code tables

Text is encoded for the selected table. Characters the table lacks are
replaced with something readable (`Á` → `A` in cp437, `€` → `EUR`, `“` → `"`,
`…` → `...`), and anything else (emoji) with `?`. Control characters are
removed, so text can never carry printer commands.

| Table | Usual `ESC t` | Notes |
|---|---|---|
| `cp437` | 0 | US default. Has á é í ó ú ñ ¿ ¡ but not Á Í Ó Ú. |
| `cp850` | 2 | Western Europe, all Spanish letters. |
| `wpc1252` | 16 | Windows Latin 1, all Spanish letters and €. |
| `cp858` | 19 | cp850 with €. Default. |

The `ESC t` number varies by printer maker. Print the test sheet
(`testSheet()`, or `tools/print-test.js` in this repo) to see which number
prints a table correctly, then pass it as `codeTableNumber`.

## Install

Not on npm yet. Install a tagged release from GitHub:

```sh
npm install https://github.com/costatechsv-spec/print-bridge/releases/download/escpos-v0.1.0/costatechsv-spec-escpos-0.1.0.tgz
```

## License

MIT
