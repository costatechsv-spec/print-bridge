'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KEEP = 2000;

// The bridge's record of what it sent, kept on disk so it survives restarts.
// A job is written as "sending" just before its bytes go out and "sent" right
// after; a job the server hands out again (because its result never got
// through) and that is already "sent" is reported, not printed twice.
class SentLog {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'sent-log.jsonl');
    this.states = new Map();
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return;
    for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const { id, state } = JSON.parse(line);
        this.states.delete(id);
        this.states.set(id, state);
      } catch {
        // A line cut short by a crash: skip it.
      }
    }
    if (this.states.size > KEEP) this.compact();
  }

  // Keeps the newest entries and rewrites the file.
  compact() {
    const entries = [...this.states].slice(-KEEP / 2);
    this.states = new Map(entries);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, entries.map(([id, state]) => JSON.stringify({ id, state })).join('\n') + '\n');
    fs.renameSync(tmp, this.file);
  }

  wasSent(id) {
    return this.states.get(id) === 'sent';
  }

  mark(id, state) {
    this.states.delete(id);
    this.states.set(id, state);
    fs.appendFileSync(this.file, JSON.stringify({ id, state, at: new Date().toISOString() }) + '\n');
    if (this.states.size > KEEP) this.compact();
  }
}

module.exports = { SentLog };
