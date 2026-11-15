'use strict';

const net = require('node:net');

// Sends a job's bytes to a network printer (raw TCP, usually port 9100).
// Resolves once the bytes are handed to the network -- raw printing has no
// acknowledgement, so that is as much as "printed" can mean. Some printers
// never close their side; the socket is closed for them shortly after.
function sendToPrinter({ host, port }, bytes, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let finished = false;
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`timeout after ${timeoutMs} ms (${host}:${port})`)));
    socket.on('error', (err) => {
      if (!finished) reject(err);
    });
    socket.on('connect', () => {
      socket.end(Buffer.from(bytes), () => {
        finished = true;
        socket.setTimeout(0);
        setTimeout(() => socket.destroy(), 2000).unref();
        resolve();
      });
    });
  });
}

// Whether the printer accepts a connection. Sends nothing.
function probePrinter({ host, port }, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done({ reachable: false, error: `timeout after ${timeoutMs} ms (${host}:${port})` }));
    socket.on('connect', () => done({ reachable: true }));
    socket.on('error', (err) => done({ reachable: false, error: err.message }));
  });
}

module.exports = { sendToPrinter, probePrinter };
