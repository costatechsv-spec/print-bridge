# print-bridge (the program)

Runs at a location, next to its printers. It polls a backend for print jobs
([CONTRACT.md](../../CONTRACT.md)), sends each job's bytes to the named
network printer (raw TCP, port 9100), and reports the result. Each poll also
reports whether each printer answers, so the backend can show "printer not
responding". Plain JavaScript, no dependencies, Node 18+: the same code runs
on Windows, macOS and Linux, including Raspberry Pi OS.

## Run

```sh
cp config.example.json config.json   # then edit it
node bin/print-bridge.js --config config.json
```

`config.json`:

```json
{
  "serverUrl": "https://api.example.com/print-bridge",
  "deviceKey": "the key the backend issued for this location",
  "printers": {
    "kitchen": { "host": "192.168.1.50", "port": 9100 },
    "counter": { "host": "192.168.1.51" }
  },
  "dataDir": "./data"
}
```

- `serverUrl` must be https (http is allowed for `localhost`, or with `"allowHttp": true` for testing on a local network).
- Printer names are what the backend uses in jobs; `port` defaults to 9100.
- `dataDir` holds the sent-jobs log, which stops a job from printing twice after a crash. Keep it on disk.
- The config path can also come from `PRINT_BRIDGE_CONFIG`.

Keep `config.json` private: the device key lets anyone take this location's print jobs.

## Behaviour

- Polls as often as the server says (`nextPollSeconds`, kept within 1–300 s).
  When the server can't be reached it retries with growing pauses, up to a minute.
- Prints each printer's jobs one at a time, in order. If a printer fails, its
  later jobs wait (are released) so nothing prints out of order; other
  printers carry on.
- Reports every result; one that can't be delivered is retried before the next poll.
- Logs one line per printed job, and one when a printer stops or starts answering.
- Stops cleanly on Ctrl+C or SIGTERM.

## Trying it without a printer or backend

From the repo root, in three terminals:

```sh
node tools/mock-server.js     # a backend: http://localhost:8080, queue test tickets there
node tools/fake-printer.js    # a printer on port 9100: see tickets at http://localhost:9101
node packages/bridge/bin/print-bridge.js --config my-config.json
```

with `serverUrl` `http://localhost:8080/print-bridge`, `deviceKey`
`dev-device-key-change-me` and printer `kitchen` at `127.0.0.1:9100`.
