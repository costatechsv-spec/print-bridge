#!/usr/bin/env node
'use strict';

// Prints the ESC/POS test sheet on a network printer (raw TCP, port 9100),
// or saves it to a file.
//
//   node tools/print-test.js 192.168.1.50
//   node tools/print-test.js 192.168.1.50 --port 9100 --width 48 --tables cp858:19,wpc1252:16
//   node tools/print-test.js --out sheet.bin
const net = require('node:net');
const fs = require('node:fs');
const { testSheet } = require('../packages/escpos');

function parseArgs(argv) {
  const args = { host: null, port: 9100, width: 48, tables: undefined, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--width') args.width = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--tables') {
      args.tables = argv[++i].split(',').map((t) => {
        const [name, number] = t.split(':');
        return { name, number: Number(number) };
      });
    } else if (!a.startsWith('--') && !args.host) args.host = a;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!args.host && !args.out) throw new Error('Give the printer IP, or --out <file>');
  return args;
}

function send(host, port, bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(5000, () => socket.destroy(new Error(`No answer from ${host}:${port} after 5 s`)));
    socket.on('connect', () => socket.end(Buffer.from(bytes)));
    socket.on('error', reject);
    socket.on('close', (hadError) => {
      if (!hadError) resolve();
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bytes = testSheet({ width: args.width, tables: args.tables }).toBytes();
  if (args.out) {
    fs.writeFileSync(args.out, bytes);
    console.log(`Saved ${bytes.length} bytes to ${args.out}`);
  }
  if (args.host) {
    await send(args.host, args.port, bytes);
    console.log(`Sent ${bytes.length} bytes to ${args.host}:${args.port}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
