/* IP Goblin — static client-side IP + geo lookup with taunting goblins. */
(function () {
  "use strict";

  var UNKNOWN = "unknown";

  var GEO_PROVIDERS = [
    {
      name: "ipwho.is",
      url: "https://ipwho.is/",
      parse: function (d) {
        if (d && d.success === false) return null;
        return normalize({
          ip: d.ip,
          city: d.city,
          region: d.region,
          country: d.country,
          countryCode: d.country_code,
          isp: (d.connection && (d.connection.isp || d.connection.org)) || null,
          asn: d.connection && d.connection.asn ? "AS" + d.connection.asn : null,
          timezone: d.timezone && (d.timezone.id || d.timezone),
          latitude: d.latitude,
          longitude: d.longitude
        });
      }
    },
    {
      name: "ipapi.co",
      url: "https://ipapi.co/json/",
      parse: function (d) {
        if (!d || d.error) return null;
        return normalize({
          ip: d.ip,
          city: d.city,
          region: d.region,
          country: d.country_name,
          countryCode: d.country_code,
          isp: d.org,
          asn: d.asn,
          timezone: d.timezone,
          latitude: d.latitude,
          longitude: d.longitude
        });
      }
    },
    {
      name: "geojs.io",
      url: "https://get.geojs.io/v1/ip/geo.json",
      parse: function (d) {
        if (!d || !d.ip) return null;
        return normalize({
          ip: d.ip,
          city: d.city,
          region: d.region,
          country: d.country,
          countryCode: d.country_code,
          isp: d.organization_name,
          asn: d.asn ? "AS" + d.asn : null,
          timezone: d.timezone,
          latitude: d.latitude,
          longitude: d.longitude
        });
      }
    }
  ];

  var TAUNTS = [
    "Ha! {ip} — we wrote it on the cave wall in glitter.",
    "A visitor from {city}! The goblins are already knocking on the wrong door.",
    "{country} {flag}? We knew it. The little one sniffed the packets and guessed right.",
    "{isp} handed us your address without even asking who we were. Rude. Efficient, but rude.",
    "Your IP is {ip}. We have memorized it. We will forget it in nine seconds. Probably.",
    "Nice coordinates, {city}. We looked. There is a bin outside. We approve of the bin.",
    "The clock in your pocket says {timezone}. It is always goblin o'clock here.",
    "{asn} — that is the ugliest number we have seen since Tuesday. Congratulations.",
    "You typed a domain and we caught your whole packet. Amateur hour, {country} {flag}.",
    "We told the other goblins about {ip}. They laughed. Then they asked for snacks.",
    "Somewhere in {region}, a router is crying. That router is yours.",
    "You came here to find your IP and we found YOU. Classic goblin business model."
  ];

  var el = {};
  var state = { geo: null, altIPs: [], tauntIndex: -1 };

  function $(id) { return document.getElementById(id); }

  function normalize(raw) {
    var lat = toNumber(raw.latitude);
    var lon = toNumber(raw.longitude);
    return {
      ip: raw.ip || null,
      city: clean(raw.city),
      region: clean(raw.region),
      country: clean(raw.country),
      countryCode: raw.countryCode ? String(raw.countryCode).trim().toUpperCase() : null,
      isp: clean(raw.isp),
      asn: clean(raw.asn),
      timezone: clean(raw.timezone),
      latitude: lat,
      longitude: lon
    };
  }

  function clean(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    return s === "" ? null : s;
  }

  function toNumber(v) {
    var n = typeof v === "number" ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function fetchJSON(url, timeoutMs) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, timeoutMs || 7000);
    var opts = { headers: { Accept: "application/json" }, cache: "no-store" };
    if (controller) opts.signal = controller.signal;
    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error(url + " responded " + res.status);
      return res.json();
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function loadGeo(index) {
    index = index || 0;
    if (index >= GEO_PROVIDERS.length) {
      return Promise.reject(new Error("every goblin scout came back empty-handed"));
    }
    var provider = GEO_PROVIDERS[index];
    return fetchJSON(provider.url).then(function (data) {
      var parsed = provider.parse(data);
      if (!parsed || !parsed.ip) throw new Error(provider.name + " gave us nothing useful");
      return parsed;
    }).catch(function () {
      return loadGeo(index + 1);
    });
  }

  function loadAltIPs() {
    var lookups = [
      { label: "IPv4", url: "https://api.ipify.org?format=json" },
      { label: "IPv6", url: "https://api6.ipify.org?format=json" }
    ].map(function (lookup) {
      return fetchJSON(lookup.url, 5000)
        .then(function (d) { return d && d.ip ? { label: lookup.label, ip: d.ip } : null; })
        .catch(function () { return null; });
    });
    return Promise.all(lookups).then(function (results) {
      return results.filter(Boolean);
    });
  }

  function flagUrl(code, width) {
    return "https://flagcdn.com/w" + width + "/" + code.toLowerCase() + ".png";
  }

  function flagEmoji(code) {
    if (!code || code.length !== 2) return "";
    return String.fromCodePoint(
      0x1f1e6 + code.toUpperCase().charCodeAt(0) - 65,
      0x1f1e6 + code.toUpperCase().charCodeAt(1) - 65
    );
  }

  function renderBanner(geo) {
    el.bannerIp.textContent = geo.ip || UNKNOWN;
    if (!geo.countryCode) return;
    var src = flagUrl(geo.countryCode, 80);
    var alt = "Flag of " + (geo.country || geo.countryCode);
    [el.flagLeft, el.flagRight].forEach(function (img) {
      img.src = src;
      img.alt = alt;
      img.hidden = false;
      img.onerror = function () { img.hidden = true; };
    });
    document.title = "IP Goblin — " + geo.ip + " " + flagEmoji(geo.countryCode);
  }

  function renderDetails(geo) {
    el.ipInput.value = geo.ip || UNKNOWN;

    if (geo.countryCode) {
      var img = document.createElement("img");
      img.className = "flag";
      img.src = flagUrl(geo.countryCode, 40);
      img.alt = "";
      img.onerror = function () { img.remove(); };
      el.dCountry.textContent = "";
      el.dCountry.appendChild(img);
      el.dCountry.appendChild(
        document.createTextNode((geo.country || geo.countryCode) + " (" + geo.countryCode + ")")
      );
    } else {
      el.dCountry.textContent = geo.country || UNKNOWN;
    }

    el.dCity.textContent = geo.city || UNKNOWN;
    el.dRegion.textContent = geo.region || UNKNOWN;
    el.dIsp.textContent = geo.isp || UNKNOWN;
    el.dAsn.textContent = geo.asn || UNKNOWN;
    el.dTimezone.textContent = geo.timezone || UNKNOWN;
    el.dLoc.textContent =
      geo.latitude !== null && geo.longitude !== null
        ? geo.latitude.toFixed(4) + ", " + geo.longitude.toFixed(4)
        : UNKNOWN;
    el.dBrowser.textContent = browserGuess();

    if (geo.latitude !== null && geo.longitude !== null) {
      el.mapLink.href =
        "https://www.openstreetmap.org/?mlat=" + geo.latitude +
        "&mlon=" + geo.longitude + "#map=11/" + geo.latitude + "/" + geo.longitude;
      el.mapLink.hidden = false;
    }
  }

  function browserGuess() {
    var parts = [];
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) parts.push(tz);
    } catch (e) { /* no Intl timezone, no problem */ }
    if (navigator.language) parts.push(navigator.language);
    return parts.length ? parts.join(" · ") : UNKNOWN;
  }

  function renderAltIPs(list) {
    el.altIPs.textContent = "";
    list.forEach(function (entry, index) {
      if (state.geo && entry.ip === state.geo.ip) return;

      var row = document.createElement("div");
      row.className = "copy-row copy-row-sub";

      var tag = document.createElement("span");
      tag.className = "ip-tag";
      tag.textContent = entry.label;

      var input = document.createElement("input");
      input.type = "text";
      input.className = "ip-address ip-address-sub";
      input.id = "alt-ip-" + index;
      input.readOnly = true;
      input.value = entry.ip;
      input.setAttribute("aria-label", "Your public " + entry.label + " address");

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-btn";
      btn.setAttribute("data-copy-target", "#" + input.id);
      btn.setAttribute("aria-label", "Copy " + entry.label + " address");
      btn.textContent = "Copy";

      row.appendChild(tag);
      row.appendChild(input);
      row.appendChild(btn);
      el.altIPs.appendChild(row);
    });
  }

  function taunt(geo) {
    var pool = TAUNTS.filter(function (t) { return fillable(t, geo); });
    if (!pool.length) pool = ["Your IP is {ip}. That is all the goblins will say today."];
    var next;
    do {
      next = Math.floor(Math.random() * pool.length);
    } while (pool.length > 1 && next === state.tauntIndex);
    state.tauntIndex = next;
    el.taunt.textContent = fill(pool[next], geo);
  }

  function tokens(geo) {
    return {
      ip: geo.ip,
      city: geo.city,
      region: geo.region,
      country: geo.country,
      isp: geo.isp,
      asn: geo.asn,
      timezone: geo.timezone,
      flag: geo.countryCode ? flagEmoji(geo.countryCode) : null
    };
  }

  function fillable(template, geo) {
    var t = tokens(geo);
    var keys = template.match(/{(\w+)}/g) || [];
    return keys.every(function (k) {
      return !!t[k.slice(1, -1)];
    });
  }

  function fill(template, geo) {
    var t = tokens(geo);
    return template.replace(/{(\w+)}/g, function (_, key) { return t[key] || UNKNOWN; });
  }

  function dossier(geo) {
    var lines = [
      "IP Address: " + (geo.ip || UNKNOWN)
    ];
    state.altIPs.forEach(function (entry) {
      if (entry.ip !== geo.ip) lines.push(entry.label + " Address: " + entry.ip);
    });
    lines.push(
      "City: " + (geo.city || UNKNOWN),
      "Region: " + (geo.region || UNKNOWN),
      "Country: " + (geo.country || UNKNOWN) + (geo.countryCode ? " (" + geo.countryCode + ")" : ""),
      "ISP: " + (geo.isp || UNKNOWN),
      "ASN: " + (geo.asn || UNKNOWN),
      "Timezone: " + (geo.timezone || UNKNOWN),
      "Coordinates: " +
        (geo.latitude !== null && geo.longitude !== null ? geo.latitude + ", " + geo.longitude : UNKNOWN)
    );
    return lines.join("\n");
  }

  var toastTimer = null;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2200);
  }

  function copyText(text) {
    if (!text) return;
    var done = function () { toast("Stolen. I mean, copied."); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
    } else {
      legacyCopy(text, done);
    }
  }

  function legacyCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) {
      toast("The goblins fumbled it. Copy it by hand.");
    }
    document.body.removeChild(ta);
  }

  function showError(message) {
    el.bannerIp.textContent = "the goblins got lost";
    el.ipInput.value = UNKNOWN;
    el.taunt.textContent = "Even goblins have bad days.";
    el.error.textContent =
      message + " An ad blocker or privacy extension may be blocking the lookup APIs.";
    el.error.hidden = false;
  }

  function bind() {
    document.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-copy-target]");
      if (!btn) return;
      var target = document.querySelector(btn.getAttribute("data-copy-target"));
      if (!target) return;
      copyText("value" in target ? target.value : target.textContent.trim());
    });

    el.copyDossier.addEventListener("click", function () {
      if (!state.geo) return;
      copyText(dossier(state.geo));
    });

    el.retaunt.addEventListener("click", function () {
      if (state.geo) taunt(state.geo);
    });
  }

  function init() {
    el = {
      bannerIp: $("banner-ip"),
      flagLeft: $("banner-flag-left"),
      flagRight: $("banner-flag-right"),
      taunt: $("taunt"),
      ipInput: $("ip-address"),
      altIPs: $("alt-ips"),
      dCountry: $("d-country"),
      dCity: $("d-city"),
      dRegion: $("d-region"),
      dIsp: $("d-isp"),
      dAsn: $("d-asn"),
      dTimezone: $("d-timezone"),
      dLoc: $("d-loc"),
      dBrowser: $("d-browser"),
      mapLink: $("map-link"),
      copyDossier: $("copy-dossier"),
      retaunt: $("retaunt"),
      error: $("error"),
      toast: $("toast")
    };

    bind();

    loadGeo().then(function (geo) {
      state.geo = geo;
      renderBanner(geo);
      renderDetails(geo);
      taunt(geo);
      return loadAltIPs();
    }).then(function (altIPs) {
      state.altIPs = altIPs;
      renderAltIPs(altIPs);
    }).catch(function (err) {
      showError(err && err.message ? err.message : "Unknown failure.");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
