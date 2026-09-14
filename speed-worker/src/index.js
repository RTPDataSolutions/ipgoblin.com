/**
 * IP Goblin speed test backend — speed.ipgoblin.com
 *
 * Three endpoints, no state, no credentials:
 *
 *   GET  /ping            204, empty. Latency and jitter come from round trips.
 *   GET  /down?bytes=N    N bytes of incompressible filler.
 *   POST /up              reads the body, discards it, reports the byte count.
 *
 * This measures the connection between the visitor and their nearest Cloudflare
 * edge, which is the same thing every browser-based speed test measures. It is
 * not a measure of the wider internet, and the /colo value says which edge
 * answered.
 *
 * Two limits shape the implementation:
 *
 *   * 10ms CPU per request on the free plan. The response body is therefore
 *     never generated per request. A fixed pool of random blocks is built once
 *     per isolate and streamed out repeatedly, so serving 100MB costs about the
 *     same CPU as serving 100KB.
 *   * Bandwidth is not metered but is not unlimited either. MAX_CHUNK caps a
 *     single response; the client caps the whole test.
 */

const BLOCK = 65536; // crypto.getRandomValues refuses anything larger
const POOL = 16; // 1 MB of distinct random data, cycled
const MAX_CHUNK = 26 * 1024 * 1024;
const MAX_UPLOAD = 26 * 1024 * 1024;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
  'timing-allow-origin': '*',
};

const NO_STORE = {
  'cache-control': 'no-store, no-transform',
  'x-robots-tag': 'noindex, nofollow',
};

const USAGE = `IP Goblin speed test backend

  GET  /ping          204 No Content, for latency and jitter
  GET  /down?bytes=N  N bytes of random filler (max ${MAX_CHUNK})
  POST /up            reads and discards the body, returns the byte count

Measures your link to the nearest Cloudflare edge. Run it from the goblins at
https://ipgoblin.com, or drive it yourself:

  curl -o /dev/null -s -w '%{speed_download} B/s\\n' \\
    'https://speed.ipgoblin.com/down?bytes=10000000'
`;

/**
 * Distinct random blocks, built once per isolate and reused for every request.
 *
 * They must be distinct: a single block repeated would sit well inside a gzip
 * window and compress away to nothing, which would inflate the measured speed.
 * A 1 MB cycle of random data is far wider than any compression window and is
 * incompressible anyway, so what crosses the wire is what we counted.
 */
let pool = null;

function blocks() {
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL; i++) {
      pool.push(crypto.getRandomValues(new Uint8Array(BLOCK)));
    }
  }
  return pool;
}

function filler(bytes) {
  const src = blocks();
  let sent = 0;
  let i = 0;

  return new ReadableStream({
    // Pull rather than push, so a slow client applies backpressure instead of
    // making us buffer the whole response in memory.
    pull(controller) {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      const block = src[i++ % POOL];
      const left = bytes - sent;
      // Copy only on the final short block; full blocks are enqueued by
      // reference, which is what keeps this inside the CPU budget.
      controller.enqueue(left >= BLOCK ? block : block.slice(0, left));
      sent += Math.min(BLOCK, left);
    },
  });
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function headers(extra) {
  return { ...CORS, ...NO_STORE, ...extra };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: headers({}) });
    }

    if (path === '/ping') {
      return new Response(null, {
        status: 204,
        headers: headers({ 'x-goblin-colo': request.cf?.colo ?? 'unknown' }),
      });
    }

    if (path === '/down') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Use GET.\n', { status: 405, headers: headers({ allow: 'GET, HEAD' }) });
      }
      const bytes = clamp(url.searchParams.get('bytes'), 0, MAX_CHUNK, 1048576);
      return new Response(request.method === 'HEAD' ? null : filler(bytes), {
        headers: headers({
          'content-type': 'application/octet-stream',
          'content-length': String(bytes),
        }),
      });
    }

    if (path === '/up') {
      if (request.method !== 'POST') {
        return new Response('Use POST.\n', { status: 405, headers: headers({ allow: 'POST' }) });
      }

      let received = 0;
      if (request.body) {
        const reader = request.body.getReader();
        // Count and drop, never buffer, so the size of the upload costs no
        // memory. The body is always drained to the end even once it is over
        // the limit: abandoning a request body mid-flight leaves the connection
        // in a broken state and the *next* request on it fails. The client has
        // already put these bytes on the wire either way.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
        }
      }

      if (received > MAX_UPLOAD) {
        return new Response(JSON.stringify({ error: 'too large', max: MAX_UPLOAD, received }), {
          status: 413,
          headers: headers({ 'content-type': 'application/json; charset=utf-8' }),
        });
      }

      return new Response(JSON.stringify({ received, colo: request.cf?.colo ?? null }), {
        headers: headers({ 'content-type': 'application/json; charset=utf-8' }),
      });
    }

    if (path === '/') {
      return new Response(USAGE, {
        headers: headers({ 'content-type': 'text/plain; charset=utf-8' }),
      });
    }

    return new Response('No such goblin. Try /\n', {
      status: 404,
      headers: headers({ 'content-type': 'text/plain; charset=utf-8' }),
    });
  },
};
