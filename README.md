# print-bridge

Automatic printing on network receipt and kitchen printers, for any web
backend. A small program at each location (the bridge) asks the backend for
print jobs, sends their bytes to the right printer, and reports back. The
backend needs no access to the local network.

Status: work in progress. Bridge and contract ready to try; first backend in progress.

| Part | Where | Status |
|---|---|---|
| Print job contract (what a backend implements) | [`CONTRACT.md`](CONTRACT.md) | v1 |
| Bridge (the program at each location) | [`packages/bridge`](packages/bridge) | 0.1.0 |
| ESC/POS library | [`packages/escpos`](packages/escpos) | 0.1.1 |
| Printer test sheet | [`tools/print-test.js`](tools/print-test.js) | Ready |
| Fake printer: tickets as a web page | [`tools/fake-printer.js`](tools/fake-printer.js) | Ready |
| Mock backend, also the contract's reference | [`tools/mock-server.js`](tools/mock-server.js) | Ready |

```
backend (any)  <--- HTTPS poll / result ---  bridge  --- TCP 9100 --->  printers
                    (outgoing only)          (at the location)
```

To try everything on one computer, see [packages/bridge](packages/bridge#trying-it-without-a-printer-or-backend).

## Setting up a new printer

With the printer on the network and its IP known (most print it on their
self-test page: hold FEED while switching on):

```sh
node tools/print-test.js 192.168.1.50
```

The sheet shows text styles, the line width and one block per code table.
The block whose sample line prints `á é í ó ú Á É Í Ó Ú ñ Ñ ü ¿ ¡ €`
correctly gives the table and `ESC t` number to configure. Other options:
`--port 9100`, `--width 48`, `--tables cp858:19,wpc1252:16`, `--out sheet.bin`
(save instead of printing).

## Development

```sh
npm test
```

Plain JavaScript, no dependencies, Node 18+; runs on Windows, macOS and Linux
(including Raspberry Pi OS).

## License

MIT
