'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { Bridge, validateConfig, ApiClient, HttpError } = require('../src');
const { startMockServer } = require('../../../tools/mock-server');
const { startFakePrinter, parseJob } = require('../../../tools/fake-printer');
const { EscPos } = require('../../escpos');

const KEY = 'test-device-key-0123456789';
const quiet = () => {};

let server;
let printer;
let dataDir;
let clock;

// A port nothing listens on, for "printer is off".
async function freePort() {
  const s = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

function makeBridge(printerPort, options = {}) {
  const config = validateConfig({
    serverUrl: server.baseUrl,
    deviceKey: KEY,
    printers: { kitchen: { host: '127.0.0.1', port: printerPort } },
    dataDir,
  });
  return new Bridge(config, { log: quiet, ...options });
}

const ticket = (text) => new EscPos().text(text).cut().toBytes();
const jobStatus = () => server.jobs.map((j) => `${j.status}/${j.attempts}`);
const settle = () => new Promise((r) => setTimeout(r, 50)); // let the fake printer record the job

beforeEach(async () => {
  clock = Date.now();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'print-bridge-test-'));
  server = await startMockServer({ port: 0, deviceKey: KEY, pollSeconds: 3, leaseSeconds: 60, now: () => clock });
  printer = await startFakePrinter({ port: 0, httpPort: null });
});

afterEach(async () => {
  await server.close();
  await printer.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('prints a job, reports it done and sends a heartbeat', async () => {
  const bytes = ticket('Comanda #1');
  server.enqueue('kitchen', bytes);
  const wait = await makeBridge(printer.port).runOnce();
  await settle();
  assert.equal(wait, 3);
  assert.deepEqual(jobStatus(), ['done/0']);
  assert.equal(printer.jobs.length, 1);
  assert.deepEqual([...printer.jobs[0].bytes], [...bytes]);
  assert.deepEqual(server.device.printers, [{ name: 'kitchen', reachable: true }]);
});

test('keeps order: after a failure the rest wait, then all print in order', async () => {
  const port = await freePort();
  server.enqueue('kitchen', ticket('first'));
  server.enqueue('kitchen', ticket('second'));
  const bridge = makeBridge(port);

  await bridge.runOnce();
  assert.deepEqual(jobStatus(), ['pending/1', 'pending/0']);
  assert.equal(server.jobs[0].error.includes('ECONNREFUSED'), true);

  await bridge.runOnce(); // still off: the heartbeat says so
  assert.equal(server.device.printers[0].reachable, false);

  const back = await startFakePrinter({ port, httpPort: null });
  try {
    await bridge.runOnce();
    await settle();
    assert.deepEqual(jobStatus(), ['done/2', 'done/0']);
    const texts = back.jobs.map((j) => parseJob(j.bytes).lines[0].segments[0].text);
    assert.deepEqual(texts, ['first', 'second']);
  } finally {
    await back.close();
  }
});

test('a job printed but never reported is not printed again after a restart', async () => {
  server.enqueue('kitchen', ticket('once'));
  // The report never reaches the server (network down right after printing).
  const offline = new ApiClient({ serverUrl: server.baseUrl, deviceKey: KEY });
  offline.report = async () => {
    throw new Error('network down');
  };
  await makeBridge(printer.port, { client: offline }).runOnce();
  await settle();
  assert.equal(printer.jobs.length, 1);
  assert.deepEqual(jobStatus(), ['claimed/0']);

  // The bridge restarts (its memory is gone); the lease runs out and the
  // server hands the job out again.
  clock += 61_000;
  await makeBridge(printer.port).runOnce();
  await settle();
  assert.equal(printer.jobs.length, 1, 'printed only once');
  assert.deepEqual(jobStatus(), ['done/0']);
});

test('a result that could not be delivered is sent before the next poll', async () => {
  server.enqueue('kitchen', ticket('x'));
  let down = true;
  const client = new ApiClient({ serverUrl: server.baseUrl, deviceKey: KEY });
  const report = client.report.bind(client);
  client.report = (...args) => (down ? Promise.reject(new Error('network down')) : report(...args));
  const bridge = makeBridge(printer.port, { client });
  await bridge.runOnce();
  assert.deepEqual(jobStatus(), ['claimed/0']);
  down = false;
  await bridge.runOnce();
  assert.deepEqual(jobStatus(), ['done/0']);
});

test('a crashed bridge lets the lease run out and the job comes back', async () => {
  server.enqueue('kitchen', ticket('lease'));
  const client = new ApiClient({ serverUrl: server.baseUrl, deviceKey: KEY });
  await client.poll({ contract: 1, printers: [] }); // claimed, then the bridge "crashes"
  assert.deepEqual(jobStatus(), ['claimed/0']);
  await makeBridge(printer.port).runOnce();
  assert.deepEqual(jobStatus(), ['claimed/0'], 'not handed out while the lease runs');
  clock += 61_000;
  await makeBridge(printer.port).runOnce();
  await settle();
  assert.deepEqual(jobStatus(), ['done/0']);
  assert.equal(printer.jobs.length, 1);
});

test('old jobs expire instead of printing late', async () => {
  server.enqueue('kitchen', ticket('late'));
  clock += 31 * 60_000;
  await makeBridge(printer.port).runOnce();
  await settle();
  assert.deepEqual(jobStatus(), ['expired/0']);
  assert.equal(printer.jobs.length, 0);
});

test('a job for a printer the bridge does not know fails with a clear error', async () => {
  server.enqueue('counter', ticket('x'));
  await makeBridge(printer.port).runOnce();
  assert.equal(server.jobs[0].status, 'pending');
  assert.match(server.jobs[0].error, /printer "counter" is not in the bridge config/);
});

test('printers work independently: one off does not hold the other', async () => {
  const off = await freePort();
  const config = validateConfig({
    serverUrl: server.baseUrl,
    deviceKey: KEY,
    printers: { kitchen: { host: '127.0.0.1', port: printer.port }, counter: { host: '127.0.0.1', port: off } },
    dataDir,
  });
  server.enqueue('counter', ticket('receipt'));
  server.enqueue('kitchen', ticket('comanda'));
  await new Bridge(config, { log: quiet }).runOnce();
  await settle();
  assert.deepEqual(jobStatus(), ['pending/1', 'done/0']);
  const status = Object.fromEntries(server.device.printers.map((p) => [p.name, p.reachable]));
  assert.deepEqual(status, { kitchen: true, counter: false });
});

test('a wrong device key is reported as 401', async () => {
  const config = validateConfig({ serverUrl: server.baseUrl, deviceKey: 'wrong-key-0123456789', printers: { kitchen: { host: '127.0.0.1' } }, dataDir });
  await assert.rejects(new Bridge(config, { log: quiet }).runOnce(), (err) => err instanceof HttpError && err.status === 401);
});

test('the server sets the poll interval, kept within 1-300 s', async () => {
  const bridge = makeBridge(printer.port);
  for (const [given, expected] of [[0.2, 1], [60, 60], [9999, 300], [undefined, 5]]) {
    bridge.client = { poll: async () => ({ jobs: [], nextPollSeconds: given }), report: async () => true };
    assert.equal(await bridge.runOnce(), expected);
  }
});

test('config is checked', () => {
  const ok = { serverUrl: 'https://api.example.com/print-bridge/', deviceKey: KEY, printers: { kitchen: { host: '10.0.0.5' } } };
  const config = validateConfig(ok, '/srv/bridge');
  assert.equal(config.serverUrl, 'https://api.example.com/print-bridge');
  assert.deepEqual(config.printers, [{ name: 'kitchen', host: '10.0.0.5', port: 9100 }]);
  assert.throws(() => validateConfig({ ...ok, serverUrl: 'http://api.example.com' }), /https/);
  assert.doesNotThrow(() => validateConfig({ ...ok, serverUrl: 'http://localhost:3001/print-bridge' }));
  assert.throws(() => validateConfig({ ...ok, deviceKey: 'short' }), /deviceKey/);
  assert.throws(() => validateConfig({ ...ok, printers: {} }), /printers/);
  assert.throws(() => validateConfig({ ...ok, printers: { 'bad name': { host: 'x' } } }), /letters/);
});

test('the fake printer reads what the library writes', () => {
  const bytes = new EscPos({ codeTable: 'cp858' })
    .align('center').bold().size(2, 2).text('NUEVA ORDEN').size(1, 1).bold(false)
    .align('left').text('2x Café · ¿Sí? ñ').cut().toBytes();
  const { lines, notes } = parseJob(bytes);
  assert.deepEqual(notes, []);
  assert.deepEqual(lines[0], { align: 'center', segments: [{ bold: true, underline: false, w: 2, h: 2, text: 'NUEVA ORDEN' }] });
  assert.equal(lines[1].segments[0].text, '2x Café · ¿Sí? ñ');
  assert.deepEqual(lines.at(-1), { cut: 'full' });
  // Without FS . a real printer may be in Chinese mode: the preview warns.
  const { notes: warned } = parseJob(Buffer.from([0x1b, 0x74, 19, 0xa4, 0x0a]));
  assert.match(warned.join(), /Chinese mode/);
});
