'use strict';

const { ApiClient, HttpError } = require('./client');
const { sendToPrinter, probePrinter } = require('./printer');
const { SentLog } = require('./sent-log');
const { version } = require('../package.json');

const PROBE_EVERY_MS = 30_000;
const MAX_BACKOFF_S = 60;

// Polls the server for jobs (CONTRACT.md), sends each to its printer in
// order, and reports the result. Each poll carries the printers' status, so
// it doubles as the heartbeat. Results that can't be delivered are kept and
// retried before the next poll.
class Bridge {
  constructor(config, { log = defaultLog, client, send = sendToPrinter, probe = probePrinter } = {}) {
    this.config = config;
    this.log = log;
    this.client = client ?? new ApiClient(config);
    this.send = send;
    this.probe = probe;
    this.sentLog = new SentLog(config.dataDir);
    this.printers = new Map(config.printers.map((p) => [p.name, { ...p, reachable: null, error: null, checkedAt: 0 }]));
    this.unreported = new Map(); // job id -> result not yet delivered
    this.stopped = true;
    this.failures = 0;
  }

  // One round: deliver pending results, refresh printer status, poll, print.
  // Returns the seconds to wait before the next round.
  async runOnce() {
    await this.flushResults();
    await this.refreshPrinters();
    const res = await this.client.poll({
      contract: 1,
      bridge: { version },
      printers: [...this.printers.values()].map((p) => ({
        name: p.name,
        reachable: p.reachable,
        ...(p.error ? { error: p.error } : {}),
      })),
    });
    const jobs = Array.isArray(res?.jobs) ? res.jobs : [];
    if (jobs.length > 0) await this.printAll(jobs);
    const next = Number(res?.nextPollSeconds);
    return Number.isFinite(next) ? Math.min(Math.max(next, 1), 300) : 5;
  }

  async start() {
    this.stopped = false;
    this.log('info', `print-bridge ${version} started: ${this.config.serverUrl}, printers ${[...this.printers.keys()].join(', ')}`);
    while (!this.stopped) {
      let wait;
      try {
        wait = await this.runOnce();
        if (this.failures > 0) this.log('info', 'server reachable again');
        this.failures = 0;
      } catch (err) {
        this.failures++;
        wait = Math.min(2 ** this.failures, MAX_BACKOFF_S);
        if (err instanceof HttpError && err.status === 401) {
          wait = MAX_BACKOFF_S;
          this.log('error', 'server rejected the device key (401); check deviceKey in the config');
        } else {
          this.log('warn', `poll failed (${err.message}); retrying in ${wait} s`);
        }
      }
      await this.sleep(wait * 1000);
    }
  }

  stop() {
    this.stopped = true;
    this.wake?.();
  }

  sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  // Each printer's jobs go out one at a time, in the order received; printers
  // work in parallel. After a failure the printer's remaining jobs are
  // released, so nothing prints ahead of the failed one.
  async printAll(jobs) {
    const queues = new Map();
    for (const job of jobs) {
      if (!queues.has(job.printer)) queues.set(job.printer, []);
      queues.get(job.printer).push(job);
    }
    await Promise.all(
      [...queues].map(async ([name, queue]) => {
        const printer = this.printers.get(name);
        for (let i = 0; i < queue.length; i++) {
          const job = queue[i];
          if (!printer) {
            await this.result(job.id, { status: 'failed', error: `printer "${name}" is not in the bridge config` });
            continue;
          }
          const ok = await this.printOne(printer, job);
          if (!ok) {
            for (const rest of queue.slice(i + 1)) await this.result(rest.id, { status: 'released' });
            break;
          }
        }
      }),
    );
  }

  async printOne(printer, job) {
    if (this.sentLog.wasSent(job.id)) {
      await this.result(job.id, { status: 'done' });
      return true;
    }
    let bytes;
    try {
      bytes = Buffer.from(String(job.data ?? ''), 'base64');
      if (bytes.length === 0) throw new Error('job has no data');
    } catch (err) {
      await this.result(job.id, { status: 'failed', error: err.message });
      return true; // the job is bad, not the printer
    }
    this.sentLog.mark(job.id, 'sending');
    try {
      await this.send(printer, bytes);
    } catch (err) {
      this.sentLog.mark(job.id, 'failed');
      // Logged once per outage, not on every retry.
      if (printer.reachable !== false || printer.error !== err.message) {
        this.log('warn', `printer ${printer.name} (${printer.host}:${printer.port}) not responding: ${err.message}; jobs wait`);
      }
      Object.assign(printer, { reachable: false, error: err.message, checkedAt: Date.now() });
      await this.result(job.id, { status: 'failed', error: err.message });
      return false;
    }
    this.sentLog.mark(job.id, 'sent');
    if (printer.reachable === false) this.log('info', `printer ${printer.name} answers again`);
    Object.assign(printer, { reachable: true, error: null, checkedAt: Date.now() });
    this.log('info', `job ${job.id} -> ${printer.name}: printed (${bytes.length} bytes)`);
    await this.result(job.id, { status: 'done' });
    return true;
  }

  // Reports a result; one that can't be delivered now waits for the next round.
  async result(jobId, result) {
    try {
      await this.client.report(jobId, result);
      this.unreported.delete(jobId);
    } catch (err) {
      this.unreported.set(jobId, result);
      this.log('warn', `could not report job ${jobId} (${err.message}); will retry`);
    }
  }

  async flushResults() {
    for (const [jobId, result] of [...this.unreported]) {
      await this.client.report(jobId, result); // throws: the round fails and backs off
      this.unreported.delete(jobId);
    }
  }

  async refreshPrinters() {
    const now = Date.now();
    await Promise.all(
      [...this.printers.values()]
        .filter((p) => now - p.checkedAt >= PROBE_EVERY_MS)
        .map(async (p) => {
          const status = await this.probe(p);
          const changed = status.reachable !== p.reachable;
          Object.assign(p, { reachable: status.reachable, error: status.error ?? null, checkedAt: Date.now() });
          if (changed) {
            this.log(status.reachable ? 'info' : 'warn', `printer ${p.name} (${p.host}:${p.port}) ${status.reachable ? 'answers' : `not responding: ${status.error}`}`);
          }
        }),
    );
  }
}

function defaultLog(level, message) {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

module.exports = { Bridge };
