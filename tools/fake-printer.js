#!/usr/bin/env node
'use strict';

// A stand-in for a network receipt printer, for testing without one. It
// accepts jobs on a TCP port like a real printer (9100), keeps them, and shows
// each as a ticket on a web page: text decoded with the code table the job
// selected, bold, underline, double size, alignment and cuts.
//
//   node tools/fake-printer.js                    # printer on 9100, page on http://localhost:9101
//   node tools/fake-printer.js --port 9102 --http 9103 --name counter
//   options: --bind 0.0.0.0 (accept from other machines), --out <dir> (save each job as .bin),
//            --tables 19=cp858,16=wpc1252 (what each ESC t number means on the printer imitated)
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const TABLES = require('../packages/escpos/src/tables');
const { DEFAULT_NUMBERS } = require('../packages/escpos/src/codepages');

const ALIGNS = ['left', 'center', 'right'];
const DEFAULT_TABLES = Object.fromEntries(Object.entries(DEFAULT_NUMBERS).map(([name, n]) => [n, name]));

// Reads a job's bytes into lines of styled text, like a printer would.
function parseJob(bytes, tables = DEFAULT_TABLES) {
  const lines = [];
  const notes = new Set();
  let state;
  const reset = () => {
    state = { align: 'left', bold: false, underline: false, w: 1, h: 1, table: 'cp437', chinese: state?.chinese ?? true };
  };
  reset();
  let line = null;
  const startLine = () => (line ??= { align: state.align, segments: [] });
  const endLine = () => {
    lines.push(line ?? { align: state.align, segments: [] });
    line = null;
  };
  const addChar = (c) => {
    startLine();
    const last = line.segments[line.segments.length - 1];
    const style = { bold: state.bold, underline: state.underline, w: state.w, h: state.h };
    if (last && Object.entries(style).every(([k, v]) => last[k] === v)) last.text += c;
    else line.segments.push({ ...style, text: c });
  };

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    const n = bytes[i + 2];
    if (b === 0x0a) endLine();
    else if (b === 0x1b) {
      const cmd = bytes[i + 1];
      if (cmd === 0x40) {
        reset();
        i += 1;
      } else if (cmd === 0x74) {
        state.table = tables[n] ?? null;
        if (!state.table) notes.add(`ESC t ${n}: table not known to this fake printer`);
        i += 2;
      } else if (cmd === 0x61) {
        state.align = ALIGNS[n % 48] ?? 'left';
        if (line && line.segments.length === 0) line.align = state.align;
        i += 2;
      } else if (cmd === 0x45) {
        state.bold = (n & 1) === 1;
        i += 2;
      } else if (cmd === 0x2d) {
        state.underline = n % 48 > 0;
        i += 2;
      } else if (cmd === 0x21) {
        Object.assign(state, { bold: (n & 8) > 0, h: n & 16 ? 2 : 1, w: n & 32 ? 2 : 1, underline: (n & 128) > 0 });
        i += 2;
      } else if (cmd === 0x64) {
        if (line) endLine();
        for (let k = 0; k < n; k++) endLine();
        i += 2;
      } else {
        notes.add(`ESC 0x${(cmd ?? 0).toString(16)}: not shown`);
        i += 1;
      }
    } else if (b === 0x1c) {
      const cmd = bytes[i + 1];
      if (cmd === 0x2e) state.chinese = false;
      else if (cmd === 0x26) state.chinese = true;
      else notes.add(`FS 0x${(cmd ?? 0).toString(16)}: not shown`);
      i += 1;
    } else if (b === 0x1d) {
      const cmd = bytes[i + 1];
      if (cmd === 0x21) {
        state.w = (n >> 4) + 1;
        state.h = (n & 7) + 1;
        i += 2;
      } else if (cmd === 0x56) {
        if (line) endLine();
        lines.push({ cut: n === 1 || n === 49 || n === 66 ? 'partial' : 'full' });
        i += n === 65 || n === 66 ? 3 : 2;
      } else {
        notes.add(`GS 0x${(cmd ?? 0).toString(16)}: not shown`);
        i += 1;
      }
    } else if (b < 0x20 || b === 0x7f) {
      // Other control bytes: ignored, as most printers do.
    } else if (b < 0x80) {
      addChar(String.fromCharCode(b));
    } else {
      if (state.chinese) notes.add('Chinese mode was never turned off (FS .): a real printer may print accents as Chinese characters');
      const c = state.table ? TABLES[state.table][b - 0x80] : null;
      if (c === null) notes.add(`byte 0x${b.toString(16)} has no character in ${state.table ?? 'the selected table'}`);
      addChar(c ?? '�');
    }
  }
  if (line) endLine();
  return { lines, notes: [...notes] };
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function ticketHtml(bytes, tables) {
  const { lines, notes } = parseJob(bytes, tables);
  const body = lines
    .map((l) => {
      if (l.cut) return `<div class="cut">✂ ${l.cut === 'partial' ? 'partial cut' : 'cut'}</div>`;
      const spans = l.segments
        .map((s) => {
          const style = [];
          // Width sets the font size (each character takes w columns);
          // a different height stretches it vertically.
          if (s.w !== 1) style.push(`font-size:${s.w}em`);
          if (s.h !== s.w) {
            const stretch = s.h / s.w;
            style.push(
              'display:inline-block',
              `transform:scaleY(${stretch})`,
              'transform-origin:bottom left',
              `margin-top:${((stretch - 1) * 1.25).toFixed(2)}em`,
            );
          }
          if (s.bold) style.push('font-weight:700');
          if (s.underline) style.push('text-decoration:underline');
          return `<span style="${style.join(';')}">${escapeHtml(s.text)}</span>`;
        })
        .join('');
      return `<div class="line" style="text-align:${l.align}">${spans || '&nbsp;'}</div>`;
    })
    .join('');
  const warn = notes.map((n) => `<div class="note">${escapeHtml(n)}</div>`).join('');
  return { body, warn };
}

function pageHtml(name, jobs, tables) {
  const tickets = [...jobs]
    .reverse()
    .map((j) => {
      const { body, warn } = ticketHtml(j.bytes, tables);
      return `<section><header>#${j.n} · ${j.at.toLocaleTimeString()} · ${j.bytes.length} bytes · <a href="/jobs/${j.n}.bin">.bin</a></header>${warn}<div class="paper">${body}</div></section>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fake printer · ${escapeHtml(name)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#e9eaec;margin:0;padding:16px;color:#1b1d21}
h1{font-size:18px;margin:0 0 4px}.sub{color:#5b6068;font-size:13px;margin-bottom:16px}
section{margin:0 auto 20px;width:fit-content;max-width:100%}
header{font-size:12px;color:#5b6068;margin-bottom:4px}
.paper{background:#fff;padding:12px 10px;box-shadow:0 1px 3px rgba(0,0,0,.2);font-family:"IBM Plex Mono",Consolas,"Courier New",monospace;font-size:13px;line-height:1.25;width:48ch;max-width:calc(100vw - 52px);overflow-x:auto}
.line{white-space:pre;min-height:1.25em}
.cut{border-top:2px dashed #b0b4ba;color:#8a8f97;font-size:11px;margin:10px -10px 6px;padding-top:2px;text-align:center}
.note{background:#fff4d6;border:1px solid #e6c25a;font-size:12px;padding:4px 6px;margin-bottom:4px}
.empty{color:#5b6068;text-align:center;margin-top:40px}
</style></head><body>
<h1>Fake printer · ${escapeHtml(name)}</h1><div class="sub">${jobs.length} job(s) received. Newest first; refreshes by itself.</div>
${tickets || '<div class="empty">Waiting for jobs…</div>'}
<script>let n=${jobs.length};setInterval(async()=>{try{const r=await fetch('/count');const j=await r.json();if(j.count!==n)location.reload()}catch{}},1500)</script>
</body></html>`;
}

// Starts the printer (TCP) and, unless httpPort is null, its web page.
async function startFakePrinter({ port = 9100, httpPort = 9101, host = '127.0.0.1', name = 'printer', tables = DEFAULT_TABLES, outDir = null, log = () => {} } = {}) {
  const jobs = [];
  if (outDir) fs.mkdirSync(outDir, { recursive: true });

  const printer = net.createServer((socket) => {
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('error', () => {});
    socket.on('end', () => socket.end());
    socket.on('close', () => {
      const bytes = Buffer.concat(chunks);
      if (bytes.length === 0) return; // a connection check, not a job
      const job = { n: jobs.length + 1, at: new Date(), bytes };
      jobs.push(job);
      if (outDir) fs.writeFileSync(path.join(outDir, `${String(job.n).padStart(4, '0')}.bin`), bytes);
      log(`job #${job.n}: ${bytes.length} bytes`);
    });
  });
  await new Promise((resolve, reject) => printer.once('error', reject).listen(port, host, resolve));

  let page = null;
  if (httpPort !== null) {
    page = http.createServer((req, res) => {
      const bin = req.url.match(/^\/jobs\/(\d+)\.bin$/);
      if (req.url === '/count') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ count: jobs.length }));
      } else if (bin && jobs[Number(bin[1]) - 1]) {
        res.setHeader('content-type', 'application/octet-stream');
        res.end(jobs[Number(bin[1]) - 1].bytes);
      } else if (req.url === '/') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(pageHtml(name, jobs, tables));
      } else {
        res.statusCode = 404;
        res.end('not found');
      }
    });
    await new Promise((resolve, reject) => page.once('error', reject).listen(httpPort, '127.0.0.1', resolve));
  }

  return {
    port: printer.address().port,
    httpPort: page ? page.address().port : null,
    jobs,
    close: () => Promise.all([new Promise((r) => printer.close(r)), page ? new Promise((r) => page.close(r)) : null]),
  };
}

function parseArgs(argv) {
  const args = { port: 9100, httpPort: 9101, host: '127.0.0.1', name: 'printer', tables: DEFAULT_TABLES, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[++i];
    if (a === '--port') args.port = Number(v);
    else if (a === '--http') args.httpPort = Number(v);
    else if (a === '--bind') args.host = v;
    else if (a === '--name') args.name = v;
    else if (a === '--out') args.outDir = v;
    else if (a === '--tables') args.tables = Object.fromEntries(v.split(',').map((t) => t.split('=')).map(([n, name]) => [Number(n), name]));
    else throw new Error(`Unknown option ${a}`);
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  startFakePrinter({ ...args, log: (m) => console.log(`${new Date().toLocaleTimeString()} ${m}`) })
    .then((p) => {
      console.log(`Fake printer "${args.name}" listening on ${args.host}:${p.port}`);
      console.log(`Tickets: http://localhost:${p.httpPort}`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { startFakePrinter, parseJob };
