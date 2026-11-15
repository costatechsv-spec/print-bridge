#!/usr/bin/env node
'use strict';

// A backend for trying the bridge without a real one: implements
// CONTRACT.md in memory, and serves a page that shows the bridge's status
// and the jobs, and queues a test ticket. Also the reference implementation
// of the contract.
//
//   node tools/mock-server.js        # http://localhost:8080, base URL http://localhost:8080/print-bridge
//   options: --port 8080 --key <device key> --poll 3 --lease 60 --expiry 30 (minutes)
const http = require('node:http');
const crypto = require('node:crypto');
const { EscPos } = require('../packages/escpos');

const DEFAULT_KEY = 'dev-device-key-change-me';

function startMockServer({
  port = 8080,
  host = '127.0.0.1',
  deviceKey = DEFAULT_KEY,
  pollSeconds = 3,
  leaseSeconds = 60,
  expiryMinutes = 30,
  now = () => Date.now(),
  log = () => {},
} = {}) {
  const jobs = [];
  const device = { lastSeenAt: null, polls: 0, printers: [], version: null };

  function enqueue(printer, data) {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'base64') : Buffer.from(data);
    const job = { id: `j_${crypto.randomBytes(6).toString('hex')}`, printer, data: bytes.toString('base64'), status: 'pending', attempts: 0, error: null, createdAt: now(), leaseUntil: 0 };
    jobs.push(job);
    return job;
  }

  function poll(body) {
    const t = now();
    Object.assign(device, { lastSeenAt: t, polls: device.polls + 1, printers: body?.printers ?? [], version: body?.bridge?.version ?? null });
    for (const j of jobs) {
      if ((j.status === 'pending' || j.status === 'claimed') && t - j.createdAt > expiryMinutes * 60_000) {
        Object.assign(j, { status: 'expired', error: j.error ?? 'expired before printing' });
      }
    }
    const available = jobs.filter((j) => j.status === 'pending' || (j.status === 'claimed' && j.leaseUntil <= t));
    for (const j of available) Object.assign(j, { status: 'claimed', leaseUntil: t + leaseSeconds * 1000 });
    return { jobs: available.map(({ id, printer, data }) => ({ id, printer, data })), leaseSeconds, nextPollSeconds: pollSeconds };
  }

  // Returns the HTTP status for a result report.
  function result(id, body) {
    const job = jobs.find((j) => j.id === id);
    if (!job) return 404;
    if (job.status === 'done' && body?.status === 'done') return 204;
    if (job.status !== 'claimed') return 409;
    if (body?.status === 'done') Object.assign(job, { status: 'done', doneAt: now(), error: null });
    else if (body?.status === 'failed') Object.assign(job, { status: 'pending', attempts: job.attempts + 1, error: String(body.error ?? 'failed') });
    else if (body?.status === 'released') Object.assign(job, { status: 'pending' });
    else return 400;
    log(`job ${id}: ${body.status}${body.error ? ` (${body.error})` : ''}`);
    return 204;
  }

  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body);
    };
    const url = new URL(req.url, 'http://x');
    const raw = await new Promise((resolve) => {
      let s = '';
      req.on('data', (c) => (s += c));
      req.on('end', () => resolve(s));
    });

    if (url.pathname.startsWith('/print-bridge/')) {
      if (req.headers.authorization !== `Bearer ${deviceKey}`) return send(401, { error: 'unknown device key' });
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(400, { error: 'invalid JSON' });
      }
      if (req.method === 'POST' && url.pathname === '/print-bridge/poll') return send(200, poll(body));
      const m = url.pathname.match(/^\/print-bridge\/jobs\/([^/]+)\/result$/);
      if (req.method === 'POST' && m) {
        const status = result(decodeURIComponent(m[1]), body);
        return status === 204 ? send(204) : send(status, { error: 'job not claimed' });
      }
      return send(404, { error: 'not found' });
    }

    if (req.method === 'POST' && url.pathname === '/test/enqueue') {
      const form = new URLSearchParams(raw);
      const job = new EscPos({ width: 48, codeTable: form.get('table') || 'cp858' })
        .align('center').bold().size(2, 2).text('TEST').size(1, 1).bold(false)
        .text(new Date(now()).toLocaleTimeString()).align('left').rule()
        .text(form.get('text') || 'Hola: á é í ó ú ñ ¿¡')
        .cut();
      enqueue(form.get('printer') || 'kitchen', job.toBytes());
      res.writeHead(303, { location: '/' });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/') return send(200, dashboard(), 'text/html; charset=utf-8');
    return send(404, { error: 'not found' });
  });

  function dashboard() {
    const t = now();
    const seen = device.lastSeenAt === null ? 'never' : `${Math.round((t - device.lastSeenAt) / 1000)} s ago`;
    const online = device.lastSeenAt !== null && t - device.lastSeenAt < pollSeconds * 3000 + 5000;
    const printers = device.printers.map((p) => `<li>${esc(p.name)}: ${p.reachable ? 'answers' : `<b>not responding</b> ${esc(p.error ?? '')}`}</li>`).join('');
    const rows = [...jobs].reverse().map((j) => `<tr><td>${esc(j.id)}</td><td>${esc(j.printer)}</td><td>${j.status}</td><td>${j.attempts}</td><td>${esc(j.error ?? '')}</td></tr>`).join('');
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock print server</title>
<style>body{font-family:system-ui,sans-serif;margin:16px;color:#1b1d21}table{border-collapse:collapse;font-size:13px}td,th{border-bottom:1px solid #ddd;padding:4px 8px;text-align:left}textarea{width:100%;max-width:420px}</style>
<h1>Mock print server</h1>
<p>Bridge: <b>${online ? 'online' : 'offline'}</b> (last poll ${seen}, ${device.polls} polls${device.version ? `, version ${esc(device.version)}` : ''})</p>
<ul>${printers || '<li>no printer status yet</li>'}</ul>
<form method="post" action="/test/enqueue"><p><label>Printer <input name="printer" value="kitchen"></label>
<label>Table <select name="table"><option>cp858</option><option>wpc1252</option><option>cp850</option><option>cp437</option></select></label></p>
<p><textarea name="text" rows="4">2x Hamburguesa clásica con queso, tocino y cebolla caramelizada
» sin pepinillos · ¿bien cocida? ¡Sí!</textarea></p><button>Queue test ticket</button></form>
<h2>Jobs</h2><table><tr><th>id</th><th>printer</th><th>status</th><th>failed attempts</th><th>last error</th></tr>${rows}</table>
<script>setTimeout(()=>location.reload(),3000)</script>`;
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject).listen(port, host, () => {
      const url = `http://localhost:${server.address().port}`;
      resolve({ url, baseUrl: `${url}/print-bridge`, deviceKey, jobs, device, enqueue, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : argv[i + 1];
  };
  startMockServer({
    port: Number(opt('port', 8080)),
    deviceKey: opt('key', DEFAULT_KEY),
    pollSeconds: Number(opt('poll', 3)),
    leaseSeconds: Number(opt('lease', 60)),
    expiryMinutes: Number(opt('expiry', 30)),
    log: (m) => console.log(`${new Date().toLocaleTimeString()} ${m}`),
  })
    .then((s) => {
      console.log(`Mock print server: ${s.url}`);
      console.log(`Bridge config: "serverUrl": "${s.baseUrl}", "deviceKey": "${s.deviceKey}"`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { startMockServer };
