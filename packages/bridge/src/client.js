'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Talks to the backend's side of the contract (CONTRACT.md).
class ApiClient {
  constructor({ serverUrl, deviceKey, timeoutMs = 15_000 }) {
    this.base = serverUrl;
    this.key = deviceKey;
    this.timeoutMs = timeoutMs;
  }

  poll(body) {
    return this.post('/poll', body);
  }

  // Returns false when the server no longer wants this result (404/409).
  async report(jobId, result) {
    try {
      await this.post(`/jobs/${encodeURIComponent(jobId)}/result`, result);
      return true;
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 409)) return false;
      throw err;
    }
  }

  async post(path, body) {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(res.status, `${path}: HTTP ${res.status} ${text.slice(0, 200)}`.trim());
    }
    return res.status === 204 ? null : res.json();
  }
}

module.exports = { ApiClient, HttpError };
