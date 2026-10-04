/**
 * IP Goblin speed test client.
 *
 * Measures the link between this browser and its nearest Cloudflare edge, which
 * is what every browser-based speed test measures. Backend: speed.ipgoblin.com.
 *
 * Three phases:
 *   ping      sequential round trips, reported as median + jitter
 *   download  parallel streams, read incrementally so speed is sampled live
 *   upload    parallel POSTs of random filler
 *
 * Download and upload both discard a warm-up window before measuring, because
 * TCP slow start and congestion-window growth make the first second far slower
 * than the steady state. Both are bounded by a time budget and a byte budget so
 * a gigabit link cannot pull a gigabyte.
 */
(function () {
  "use strict";

  var ENDPOINT = "https://speed.ipgoblin.com";

  var PING_COUNT = 10;
  var STREAMS = 4;

  var DOWN_MS = 8000;
  var DOWN_BUDGET = 120 * 1024 * 1024;
  var DOWN_START = 1048576;
  var DOWN_MAX = 26 * 1024 * 1024;

  var UP_MS = 6000;
  var UP_BUDGET = 48 * 1024 * 1024;
  var UP_START = 262144;
  var UP_MAX = 8 * 1024 * 1024;

  // Warm-up discarded from every throughput measurement. TCP slow start makes
  // the first second far slower than the steady state. Capped at a fraction of
  // the run so that a short run (a fast link hitting its byte budget early)
  // still leaves a measurable window rather than discarding everything.
  var WARMUP_MS = 1200;
  var WARMUP_FRACTION = 0.4;
  var GROW_BELOW_MS = 1200;

  var el = {};
  var running = false;
  var results = null;
  var payload = null;

  function $(id) { return document.getElementById(id); }
  function noop() {}

  function now() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function median(values) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** Mean absolute difference between consecutive round trips. */
  function jitterOf(values) {
    if (values.length < 2) return 0;
    var total = 0;
    for (var i = 1; i < values.length; i++) {
      total += Math.abs(values[i] - values[i - 1]);
    }
    return total / (values.length - 1);
  }

  function isAbort(err) {
    return err && (err.name === "AbortError" || err.name === "TimeoutError");
  }

  /**
   * Random filler for uploads, built once and reused.
   *
   * getRandomValues refuses buffers over 64KB, so it is filled blockwise. It
   * must be random rather than zeroes: zeroes would compress to nothing if
   * anything on the path applied compression, and the measurement would be a
   * fiction.
   */
  function uploadPayload() {
    if (payload) return payload;
    payload = new Uint8Array(UP_MAX);
    var block = 65536;
    for (var off = 0; off < payload.length; off += block) {
      crypto.getRandomValues(payload.subarray(off, Math.min(off + block, payload.length)));
    }
    return payload;
  }

  /* ---------- measurement ---------- */

  function newRun(budget) {
    // `bytes` is what has arrived and been measured; `committed` is what has
    // been promised to the wire including requests still in flight. The budget
    // is enforced against `committed`, because several parallel streams would
    // otherwise all read a stale `bytes` and each launch one more chunk.
    return { bytes: 0, committed: 0, samples: [], budget: budget, started: 0 };
  }

  function sample(run) {
    run.samples.push([now(), run.bytes]);
  }

  /**
   * Steady-state throughput in Mbps, ignoring the warm-up window.
   *
   * Falls back to the whole window when the test was too short to have a
   * steady state at all, which is what happens on very slow links.
   */
  function mbps(run) {
    var s = run.samples;
    if (s.length < 2) return 0;

    var end = s[s.length - 1];
    var warmup = Math.min(WARMUP_MS, (end[0] - run.started) * WARMUP_FRACTION);
    var cutoff = run.started + warmup;
    var base = null;
    for (var i = 0; i < s.length; i++) {
      if (s[i][0] >= cutoff) { base = s[i]; break; }
    }

    var ms, bytes;

    if (base && end[0] > base[0] && end[1] > base[1]) {
      ms = end[0] - base[0];
      bytes = end[1] - base[1];
    } else {
      ms = end[0] - run.started;
      bytes = end[1];
    }

    if (ms <= 0 || bytes <= 0) return 0;
    return (bytes * 8) / (ms * 1000);
  }

  /** Throughput over roughly the last second, for the live readout. */
  function recentMbps(run) {
    var s = run.samples;
    if (s.length < 2) return 0;
    var end = s[s.length - 1];
    var base = s[0];
    for (var i = s.length - 1; i >= 0; i--) {
      if (end[0] - s[i][0] >= 1000) { base = s[i]; break; }
    }
    var ms = end[0] - base[0];
    var bytes = end[1] - base[1];
    if (ms <= 0 || bytes <= 0) return 0;
    return (bytes * 8) / (ms * 1000);
  }

  function ping() {
    var trips = [];
    var colo = null;
    var index = 0;

    function once() {
      if (index >= PING_COUNT) return Promise.resolve();
      index++;
      var started = now();
      return fetch(ENDPOINT + "/ping?n=" + index + "." + Math.random(), {
        cache: "no-store",
        mode: "cors"
      }).then(function (res) {
        if (!res.ok && res.status !== 204) throw new Error("ping failed: " + res.status);
        trips.push(now() - started);
        if (!colo) colo = res.headers.get("x-goblin-colo");
        setPhase("Pinging the goblins… " + index + "/" + PING_COUNT);
      }, function () {
        // A dropped probe is a data point about the link, not a reason to
        // abandon the test. Only a total blackout is fatal, checked below.
      }).then(once);
    }

    // The first trip pays for DNS, TLS and the TCP handshake, so it is thrown
    // away rather than being allowed to poison the median.
    return once().then(function () {
      if (!trips.length) throw new Error("Could not reach speed.ipgoblin.com.");
      var useful = trips.length > 1 ? trips.slice(1) : trips;
      return { ping: median(useful), jitter: jitterOf(useful), colo: colo };
    });
  }

  function downloadStream(ctl, run, deadline) {
    var size = DOWN_START;

    function done() {
      return now() >= deadline || run.bytes >= run.budget;
    }

    function next() {
      if (done()) return Promise.resolve();
      var started = now();
      var url = ENDPOINT + "/down?bytes=" + size + "&t=" + Math.random();

      return fetch(url, { cache: "no-store", mode: "cors", signal: ctl.signal })
        .then(function (res) {
          if (!res.ok || !res.body) throw new Error("download failed: " + res.status);
          var reader = res.body.getReader();

          function pump() {
            return reader.read().then(function (chunk) {
              if (chunk.done) return null;
              run.bytes += chunk.value.byteLength;
              sample(run);
              if (done()) return reader.cancel().then(noop, noop);
              return pump();
            });
          }
          return pump();
        })
        .then(function () {
          // Ramp up while each chunk is finishing quickly, so a fast link gets
          // large chunks (less per-request overhead) and a slow one keeps small
          // chunks (so it still produces samples and can stop on time).
          if (now() - started < GROW_BELOW_MS && size < DOWN_MAX) {
            size = Math.min(size * 2, DOWN_MAX);
          }
          return next();
        });
    }

    // A stream that dies part-way should not lose the whole measurement. If
    // anything at all arrived, keep it and let this stream bow out; only a
    // total failure is worth reporting. Transient resets and edge rate limits
    // are normal on a test that deliberately opens several fat connections.
    return next().catch(function (err) {
      if (isAbort(err) || run.bytes > 0) return null;
      throw err;
    });
  }

  function uploadStream(ctl, run, deadline) {
    var size = UP_START;
    var buf = uploadPayload();

    function done() {
      return now() >= deadline || run.committed >= run.budget;
    }

    function next() {
      if (done()) return Promise.resolve();
      var started = now();
      var body = buf.subarray(0, size);

      // Reserve the bytes before sending them, so the other streams see this
      // chunk while it is still in flight and stop instead of each piling on
      // one more.
      run.committed += size;

      return fetch(ENDPOINT + "/up?t=" + Math.random(), {
        method: "POST",
        body: body,
        cache: "no-store",
        mode: "cors",
        signal: ctl.signal,
        headers: { "content-type": "application/octet-stream" }
      })
        .then(function (res) {
          if (!res.ok) throw new Error("upload failed: " + res.status);
          return res.json();
        })
        .then(function () {
          // The response only comes back once the worker has drained the whole
          // body, so the round trip bounds the time the bytes took to arrive.
          run.bytes += size;
          sample(run);
          if (now() - started < GROW_BELOW_MS && size < UP_MAX) {
            size = Math.min(size * 2, UP_MAX);
          }
          return next();
        });
    }

    // Same tolerance as the download: keep a partial measurement rather than
    // discarding the run because one chunk was reset.
    return next().catch(function (err) {
      if (isAbort(err) || run.bytes > 0) return null;
      throw err;
    });
  }

  function phase(label, spawn, budget, duration) {
    var run = newRun(budget);
    var ctl = new AbortController();
    var deadline;
    var ticker;
    var stop;

    return new Promise(function (resolve, reject) {
      run.started = now();
      deadline = run.started + duration;

      ticker = setInterval(function () {
        var live = recentMbps(run);
        setLive(live);
        setProgress(Math.min(1, Math.max(
          (now() - run.started) / duration,
          run.bytes / budget
        )));
        setPhase(label + " " + fmt(live) + " Mbps");
      }, 120);

      // A hard stop, in case a stalled connection never resolves its read.
      stop = setTimeout(function () { ctl.abort(); }, duration + 3000);

      var streams = [];
      for (var i = 0; i < STREAMS; i++) streams.push(spawn(ctl, run, deadline));

      Promise.all(streams).then(function () { resolve(run); }, function (err) {
        if (isAbort(err)) resolve(run);
        else reject(err);
      });
    }).then(function (value) {
      clearInterval(ticker);
      clearTimeout(stop);
      ctl.abort();
      return value;
    }, function (err) {
      clearInterval(ticker);
      clearTimeout(stop);
      ctl.abort();
      throw err;
    });
  }

  /* ---------- presentation ---------- */

  function fmt(value) {
    if (!value || !isFinite(value)) return "0";
    if (value >= 100) return String(Math.round(value));
    if (value >= 10) return value.toFixed(1);
    return value.toFixed(2);
  }

  function fmtMs(value) {
    if (!value || !isFinite(value)) return "—";
    return (value >= 100 ? Math.round(value) : value.toFixed(1)) + " ms";
  }

  function setPhase(text) {
    el.phase.textContent = text;
  }

  function setLive(value) {
    el.live.textContent = fmt(value);
  }

  function setProgress(fraction) {
    var pct = Math.max(0, Math.min(1, fraction)) * 100;
    el.runner.style.left = pct + "%";
    el.fill.style.width = pct + "%";
  }

  var VERDICTS = [
    [0.5, "That is not a connection, that is a rumour. The goblins carried your packets by hand and still beat it."],
    [2, "Dial-up called. It wants its dignity back. We have started a collection for you."],
    [10, "The goblins finished their lunch waiting for that. Twice."],
    [25, "Serviceable. Nobody will write songs about it, but nothing will catch fire either."],
    [100, "Respectable. The goblins are mildly annoyed at having nothing to mock."],
    [400, "Fast. Suspiciously fast. Are you stealing this from a neighbour? We approve either way."],
    [Infinity, "The goblins have stopped laughing. One of them is taking notes. This is the highest honour we give."]
  ];

  function verdict(down, up, latency) {
    var line = VERDICTS[VERDICTS.length - 1][1];
    for (var i = 0; i < VERDICTS.length; i++) {
      if (down < VERDICTS[i][0]) { line = VERDICTS[i][1]; break; }
    }
    if (latency > 250) {
      line += " Your latency is " + fmtMs(latency) + " though, so every click is a letter posted uphill.";
    } else if (up > 0 && down / up > 12) {
      line += " Download " + fmt(down) + ", upload " + fmt(up) + ". Your ISP loves you taking, not giving.";
    }
    return line;
  }

  function setStat(node, value) {
    node.textContent = value;
  }

  function summary() {
    if (!results) return "";
    return [
      "IP Goblin speed test — ipgoblin.com",
      "Download : " + fmt(results.down) + " Mbps",
      "Upload   : " + fmt(results.up) + " Mbps",
      "Latency  : " + fmtMs(results.ping),
      "Jitter   : " + fmtMs(results.jitter),
      "Edge     : " + (results.colo || "unknown"),
      "Measured : " + new Date().toISOString()
    ].join("\n");
  }

  function reset() {
    setStat(el.down, "—");
    setStat(el.up, "—");
    setStat(el.ping, "—");
    setStat(el.jitter, "—");
    el.verdict.hidden = true;
    el.copy.hidden = true;
    el.error.hidden = true;
    setProgress(0);
    setLive(0);
  }

  function fail(message) {
    el.error.textContent = message +
      " The speed test needs speed.ipgoblin.com to be reachable — an ad blocker, " +
      "a corporate proxy or a privacy extension may be blocking it.";
    el.error.hidden = false;
    setPhase("The goblins tripped over each other.");
  }

  function start() {
    if (running) return;
    running = true;
    results = null;
    reset();
    el.start.disabled = true;
    el.start.textContent = "Goblins running…";
    el.card.classList.add("is-running");

    var collected = {};

    setPhase("Waking the goblins…");

    ping()
      .then(function (r) {
        collected.ping = r.ping;
        collected.jitter = r.jitter;
        collected.colo = r.colo;
        setStat(el.ping, fmtMs(r.ping));
        setStat(el.jitter, fmtMs(r.jitter));
        el.card.classList.add("is-down");
        setProgress(0);
        return phase("Hauling loot down…", downloadStream, DOWN_BUDGET, DOWN_MS);
      })
      .then(function (run) {
        collected.down = mbps(run);
        setStat(el.down, fmt(collected.down));
        el.card.classList.remove("is-down");
        el.card.classList.add("is-up");
        setProgress(0);
        return phase("Dragging loot back up…", uploadStream, UP_BUDGET, UP_MS);
      })
      .then(function (run) {
        collected.up = mbps(run);
        setStat(el.up, fmt(collected.up));
        results = collected;

        el.verdict.textContent = verdict(collected.down, collected.up, collected.ping);
        el.verdict.hidden = false;
        el.copy.hidden = false;
        setPhase("Done. Edge: " + (collected.colo || "unknown") + ".");
        setLive(collected.down);
        setProgress(1);
      })
      .catch(function (err) {
        fail(err && err.message ? err.message : "The speed test failed.");
      })
      .then(function () {
        running = false;
        el.start.disabled = false;
        el.start.textContent = "Run it again";
        el.card.classList.remove("is-running", "is-down", "is-up");
      });
  }

  function copyResults() {
    var text = summary();
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flash, flash);
    } else {
      flash();
    }
  }

  function flash() {
    var toast = $("toast");
    if (!toast) return;
    toast.textContent = "Results stolen. I mean, copied.";
    toast.hidden = false;
    setTimeout(function () { toast.hidden = true; }, 2200);
  }

  function init() {
    el.card = $("sp-card");
    el.start = $("sp-start");
    el.copy = $("sp-copy");
    el.phase = $("sp-phase");
    el.live = $("sp-live");
    el.runner = $("sp-runner");
    el.fill = $("sp-fill");
    el.down = $("sp-down");
    el.up = $("sp-up");
    el.ping = $("sp-ping");
    el.jitter = $("sp-jitter");
    el.verdict = $("sp-verdict");
    el.error = $("sp-error");

    if (!el.card || !el.start) return;

    if (!window.fetch || !window.AbortController || !window.ReadableStream) {
      el.start.disabled = true;
      setPhase("This browser is too old for the goblins to race. Try a current one.");
      return;
    }

    el.start.addEventListener("click", start);
    el.copy.addEventListener("click", copyResults);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
