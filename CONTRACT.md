# Print job contract (v1)

What a backend implements so a print bridge can print its jobs. The bridge
runs next to the printers and only makes outgoing HTTPS requests; the
backend never needs to reach the local network.

A reference implementation, in memory, is [`tools/mock-server.js`](tools/mock-server.js).

## Basics

- The bridge is configured with a **base URL** (e.g. `https://api.example.com/print-bridge`)
  and a **device key**. Every request sends `Authorization: Bearer <device key>`.
  The backend maps the key to one device (e.g. one location) and answers
  `401` to anything else.
- Bodies are JSON. Times are the backend's; the bridge never relies on its own clock.
- A **job** is `{ id, printer, data }`: an opaque string id, the printer
  name (as configured on the bridge, e.g. `kitchen`), and the bytes to send,
  base64-encoded. The backend builds the bytes (ESC/POS etc.); the bridge
  sends them unchanged.

## `POST {base}/poll`

Gets jobs to print. Every poll also counts as the device's **heartbeat**.

Request:

```json
{
  "contract": 1,
  "bridge": { "version": "0.1.0" },
  "printers": [
    { "name": "kitchen", "reachable": true },
    { "name": "counter", "reachable": false, "error": "connect ETIMEDOUT 192.168.1.51:9100" }
  ]
}
```

Response `200`:

```json
{
  "jobs": [{ "id": "j_123", "printer": "kitchen", "data": "G0AcLhs0..." }],
  "leaseSeconds": 60,
  "nextPollSeconds": 3
}
```

The backend:

1. Records the heartbeat: the time, and each printer's `reachable`/`error`.
2. Returns this device's **available** jobs, oldest first: jobs not yet
   claimed, plus claimed jobs whose lease has run out.
3. Marks the returned jobs **claimed** by this device until now + `leaseSeconds`.
4. Sets `nextPollSeconds`: when the bridge should poll again (e.g. 3 while
   the business is open, 60 otherwise). The bridge keeps it within 1–300.
5. Expires jobs too old to be worth printing (e.g. 30 minutes) instead of
   returning them, so they are not printed late.

## `POST {base}/jobs/{id}/result`

Reports what happened to a claimed job.

```json
{ "status": "done" }
{ "status": "failed", "error": "connect ECONNREFUSED 192.168.1.50:9100" }
{ "status": "released" }
```

- `done`: the printer accepted the bytes. Final. Repeating it is harmless.
- `failed`: the printer could not take the job. The backend records the
  error and makes the job available again (it is retried on a later poll)
  unless it has expired.
- `released`: not attempted (an earlier job for the same printer failed, so
  this one waits its turn). Available again, without counting as an attempt.

Response `204`. `404` or `409` (unknown job, or not claimed by this device)
tell the bridge to stop reporting it.

## Guarantees

- **Order:** the bridge prints each printer's jobs in the order received and
  stops at the first failure for that printer, releasing the rest, so jobs
  never print out of order as long as polls return oldest first.
- **No lost jobs:** a job leaves the backend's queue only on `done` or expiry.
  A bridge that crashes mid-job lets its lease run out and the job comes back.
- **Rare duplicates:** printing over raw TCP has no acknowledgement. The
  bridge keeps a local log of jobs it sent, so a job it printed but could not
  report is reported, not printed again. Only a crash in the instant between
  sending and logging can print a job twice. "Done" means the printer
  accepted the bytes, not that paper came out.
- **Liveness:** a device is offline when it has not polled for a few poll
  intervals. A printer is "not responding" when the latest poll says
  `reachable: false`.
