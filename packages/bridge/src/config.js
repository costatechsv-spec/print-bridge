'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PRINTER_NAME = /^[A-Za-z0-9_-]{1,40}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Reads the bridge's config file:
//
//   {
//     "serverUrl": "https://api.example.com/print-bridge",
//     "deviceKey": "...",
//     "printers": { "kitchen": { "host": "192.168.1.50", "port": 9100 } },
//     "dataDir": "./data"
//   }
//
// Relative paths are resolved from the config file's folder.
function loadConfig(file) {
  const full = path.resolve(file);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read config ${full}: ${err.message}`);
  }
  return validateConfig(raw, path.dirname(full));
}

function validateConfig(raw, baseDir = process.cwd()) {
  const errors = [];
  let serverUrl = '';
  try {
    const url = new URL(raw.serverUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (LOCAL_HOSTS.has(url.hostname) || raw.allowHttp))) {
      errors.push('serverUrl must use https (http only for localhost, or with "allowHttp": true)');
    }
    serverUrl = url.toString().replace(/\/+$/, '');
  } catch {
    errors.push('serverUrl must be a URL');
  }

  if (typeof raw.deviceKey !== 'string' || raw.deviceKey.length < 16) {
    errors.push('deviceKey must be a string of at least 16 characters');
  }

  const printers = [];
  if (!raw.printers || typeof raw.printers !== 'object' || Object.keys(raw.printers).length === 0) {
    errors.push('printers must name at least one printer, e.g. { "kitchen": { "host": "192.168.1.50" } }');
  } else {
    for (const [name, p] of Object.entries(raw.printers)) {
      const port = p?.port ?? 9100;
      if (!PRINTER_NAME.test(name)) errors.push(`printer name "${name}": letters, digits, - and _ only`);
      if (typeof p?.host !== 'string' || p.host === '') errors.push(`printer "${name}": host is required`);
      if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push(`printer "${name}": port must be 1-65535`);
      printers.push({ name, host: p?.host, port });
    }
  }

  if (errors.length > 0) throw new Error(`Invalid config:\n- ${errors.join('\n- ')}`);
  return {
    serverUrl,
    deviceKey: raw.deviceKey,
    printers,
    dataDir: path.resolve(baseDir, raw.dataDir ?? 'data'),
  };
}

module.exports = { loadConfig, validateConfig };
