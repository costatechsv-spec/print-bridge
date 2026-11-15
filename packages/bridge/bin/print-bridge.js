#!/usr/bin/env node
'use strict';

// Runs the print bridge until stopped (Ctrl+C, or SIGTERM from a service
// manager). The config path comes from --config, then PRINT_BRIDGE_CONFIG,
// then ./config.json.
const { Bridge, loadConfig } = require('../src');

function configPath(argv) {
  const i = argv.indexOf('--config');
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return process.env.PRINT_BRIDGE_CONFIG || 'config.json';
}

let bridge;
try {
  bridge = new Bridge(loadConfig(configPath(process.argv.slice(2))));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`${signal}: stopping after the current round`);
    bridge.stop();
  });
}

bridge.start().then(() => process.exit(0));
