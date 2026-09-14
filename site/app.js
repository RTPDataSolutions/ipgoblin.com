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
    "Your IP is {ip}. We have memorized it. We will forget it in nine seconds. Probably.",
    "We told the other goblins about {ip}. They laughed. Then they asked for snacks.",
    "You came here to find your IP and we found YOU. Classic goblin business model.",
    "{ip}. We said it out loud. The cave echoed. Everyone heard.",
    "{ip} arrived wearing no disguise at all. Bold.",
    "We put {ip} on a sticky note. The sticky note is on a goblin. The goblin is asleep.",
    "{ip} knocked. We did not answer. We just wrote it down.",
    "A packet from {ip} wandered in and asked for directions. We gave it wrong ones.",
    "{ip}? Never heard of it. (We have. It is in the ledger. Page four.)",
    "The goblins voted. {ip} is the seventh-best IP they have seen today.",
    "{ip} — spelled it twice, laughed both times.",
    "We ran {ip} through the machine. The machine said 'yep, that is an IP'. Ten gold pieces.",
    "Somewhere a firewall thinks it is protecting {ip}. Adorable.",
    "{ip} came here voluntarily. That is the part we find funniest.",
    "Your address is {ip}. Your secret is safe with us and the forty goblins behind us.",
    "{ip} has been added to the wall. The wall is full. We are getting a bigger wall.",
    "Hello {ip}. Goodbye {ip}. We are already bored of {ip}.",
    "{ip} looks expensive. Is it expensive? We will assume it is expensive.",
    "The goblins tried to eat {ip}. It was not food. They are disappointed.",
    "{ip} — a fine number. Not the finest. Fine.",
    "We showed {ip} to the oldest goblin. He squinted. He approved. Mostly.",
    "{ip} will be traded to another goblin for half a sandwich.",
    "Congratulations, {ip}. You are exactly where you said you were.",
    "{ip} tried to sneak past. It was walking very loudly.",
    "We have {ip} written in three places now. One of them is a goblin forehead.",
    "{ip}: catalogued, mocked, filed under 'later'.",
    "The goblins have opinions about {ip}. None of them are kind.",
    "{ip} showed up uninvited, which is the only way anyone shows up here.",
    "We asked the network who you were. It said {ip} immediately. No loyalty.",
    "{ip} — we will remember this. We will not remember why.",
    "Every packet you send waves a little flag that says {ip}. Every single one.",
    "{ip} is now goblin property. Read the sign. There is no sign.",
    "We could keep {ip} a secret. We have chosen not to.",
    "A goblin scribbled {ip} on the ceiling. We do not know how.",
    "{ip}. Yes. That is the one. That is definitely the one.",
    "You wanted your IP. Here: {ip}. Now leave before they notice.",
    "{ip} has been reported to the goblin council. The council is three rats.",
    "We tracked {ip} across the whole internet. It took no effort at all.",
    "{ip} thought about using a VPN. Thinking is not using.",
    "The goblins chanted {ip} for a while. Then they got tired.",
    "{ip} is not hiding. {ip} has never hidden. {ip} does not know how.",
    "We would forget {ip}, but the little one is already singing about it.",
    "{ip} arrived at the door and immediately handed us everything.",
    "There is a jar. In the jar is {ip}. Do not ask about the jar.",
    "{country} {flag}? We knew it. The little one sniffed the packets and guessed right.",
    "You typed a domain and we caught your whole packet. Amateur hour, {country} {flag}.",
    "{flag} {country}. The goblins have been there. They were asked to leave.",
    "All the way from {country} {flag} just to be insulted. Worth it.",
    "{country} {flag} — good choice. The goblins have a cousin there. Do not trust him.",
    "A {country} {flag} packet walks into a cave. The cave writes down {ip}.",
    "{flag} Ah, {country}. That explains the smell of the packets. Pleasant, mostly.",
    "The goblins raised the {country} flag {flag}. Upside down. On purpose. Probably.",
    "Nobody from {country} {flag} has ever escaped this page. Nobody has tried.",
    "{country} {flag} sends its worst. We accept.",
    "You are {ip}, of {country} {flag}, and you are not subtle.",
    "{flag} The {country} goblins are worse than us. Count yourself lucky.",
    "We have a map. {country} {flag} is on it. You are on it now too.",
    "Welcome, {country} {flag}. Wipe your packets at the door.",
    "{country} {flag}. The goblins nod. That is all you get.",
    "A visitor from {city}! The goblins are already knocking on the wrong door.",
    "Nice coordinates, {city}. We looked. There is a bin outside. We approve of the bin.",
    "{city}. We have not been. We have opinions anyway.",
    "Someone in {city} just got a lot less anonymous.",
    "{city} — lovely place. Terrible packets.",
    "The goblins are dispatching a scout to {city}. He will get lost. He always does.",
    "{ip} of {city}. It rhymes if you say it wrong.",
    "We have marked {city} on the map with a crayon. It is the wrong colour.",
    "{city}? The goblins were banned from {city}. Long story. Bad story.",
    "Say hello to {city} for us. Do not say who sent you.",
    "Everything interesting in {city} is happening at {ip} right now. Allegedly.",
    "The little goblin wants to visit {city}. He has no legs. He has ambition.",
    "{city}. Filed. Laminated. Mocked.",
    "There are goblins under {city}. There are goblins under everywhere.",
    "You are in {city} and your router told us so without hesitating.",
    "{isp} handed us your address without even asking who we were. Rude. Efficient, but rude.",
    "{isp} is doing its best. Its best is telling us exactly where you are.",
    "We sent {isp} a thank-you note for {ip}. No reply. Typical.",
    "{isp} could have stopped this. {isp} did not even blink.",
    "Your packets wear a little {isp} hat. We can see the hat.",
    "{isp} — the goblins salute you, informant.",
    "Somewhere at {isp} there is a goblin on the payroll. Allegedly.",
    "{isp} gave you {ip} and a lifetime of being findable.",
    "If {isp} were a goblin, it would be the one who talks too much.",
    "We asked {isp} nicely. We did not have to ask nicely.",
    "{asn} — that is the ugliest number we have seen since Tuesday. Congratulations.",
    "{asn}. The goblins tried to pronounce it. Two of them fainted.",
    "You ride in on {asn} like it means something. It does. It means we found you.",
    "{asn} is a fine autonomous system. Autonomous. Not private. Learn the difference.",
    "The goblins have a grudge against {asn}. They have forgotten why.",
    "{asn} carried your packets all this way just to hand them to us.",
    "We have {asn} in the ledger under 'frequent offenders'.",
    "The clock in your pocket says {timezone}. It is always goblin o'clock here.",
    "{timezone}? Should you not be asleep? The goblins are asleep. Mostly.",
    "Your clock says {timezone}. Ours says 'soon'. Ours is better.",
    "We know it is {timezone} where you are. We know more than that.",
    "{timezone} — a fine time to be caught.",
    "The goblins do not observe {timezone}. The goblins observe nothing.",
    "Somewhere in {timezone}, {ip} is doing something it should not.",
    "{timezone}. Noted. Your schedule is now goblin business.",
    "Somewhere in {region}, a router is crying. That router is yours.",
    "{region} is not big enough to hide {ip}. Nowhere is.",
    "The goblins have relatives in {region}. Do not contact them.",
    "{region}. Bold of you to have a location at all.",
    "We narrowed it to {region}, then to {city}, then we got bored and wrote {ip}.",
    "All of {region} just got tagged because of you.",
    "{city}, {region}, {country} {flag}. We did not have to work for any of that.",
    "{isp} in {city} — a combination the goblins find hilarious.",
    "{ip} from {city} riding {asn}. A whole biography in one packet.",
    "It is {timezone} in {city} and {ip} is still awake. Suspicious.",
    "{flag} {country} routes its shame through {isp}. We just watch.",
    "The ledger now reads: {ip}, {city}, {country}. Signed, a goblin.",
    "{asn} in {country} {flag}. The goblins are updating the chart.",
    "You, {ip}, in {timezone}, thinking nobody would look. We always look.",
    "{isp} says {region}. The packets say {city}. Both of them told on you."
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

  function pickIPv4(altIPs) {
    if (!altIPs) return null;
    for (var i = 0; i < altIPs.length; i++) {
      if (altIPs[i].label === "IPv4" && altIPs[i].ip) return altIPs[i].ip;
    }
    return null;
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
    var ip = geo.ip || UNKNOWN;
    el.bannerIp.textContent = ip;
    if (!geo.countryCode) return;
    var src = flagUrl(geo.countryCode, 80);
    var alt = "Flag of " + (geo.country || geo.countryCode);
    [el.flagLeft, el.flagRight].forEach(function (img) {
      img.src = src;
      img.alt = alt;
      img.hidden = false;
      img.onerror = function () { img.hidden = true; };
    });
    document.title = "IP Goblin — " + ip + " " + flagEmoji(geo.countryCode);
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

    // Both lookups start together, so preferring IPv4 costs no extra latency.
    Promise.all([loadGeo(), loadAltIPs()]).then(function (results) {
      var geo = results[0];
      var altIPs = results[1];

      // The geo provider reports whichever address it happened to see, which is
      // IPv6 on a dual-stack connection. Present the IPv4 instead. Everything
      // downstream keys off geo.ip, so setting it here makes the banner, the
      // dossier, the taunts and the alt-IP rows agree. The IPv6 is still listed
      // as an alternate, because renderAltIPs only skips the address shown above.
      geo.ip = pickIPv4(altIPs) || geo.ip;

      state.geo = geo;
      state.altIPs = altIPs;

      renderBanner(geo);
      renderDetails(geo);
      taunt(geo);
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
