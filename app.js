/* UN Day 2026 · Stall WhatsApp Groups
 * Reads links.txt ("Stall Name | https://chat.whatsapp.com/... | full") and builds the grid.
 * The third column is optional. "full" (any case) marks the team as full: the tile stays
 * visible but is not a link, even when an invite URL is present.
 * To add a new stall's flags, add an entry to STALL_FLAGS below (key = stall name,
 * values = file names in flags/ without ".svg"). Unknown stall names get a globe icon.
 */
(function () {
  "use strict";

  var LINKS_FILE = "links.txt";

  // Stall name -> flag files (flags/<code>.svg) + readable alt text.
  var STALL_FLAGS = {
    "Sri Lanka": [["lk", "Sri Lanka"]],
    "India": [["in", "India"]],
    "USA/Canada": [["us", "United States"], ["ca", "Canada"]],
    "Europe": [["eu", "European Union"]],
    "Japan": [["jp", "Japan"]],
    "Singapore/Malaysia/Thailand": [["sg", "Singapore"], ["my", "Malaysia"], ["th", "Thailand"]],
    "Middle East": [["ae", "United Arab Emirates"], ["sa", "Saudi Arabia"], ["jo", "Jordan"], ["om", "Oman"]],
    "China": [["cn", "China"]],
    "Eco Warriors": [["eco", "Eco Warriors", "Green leaf"]],
    "Australia/NZ/Philippines/Indonesia": [["au", "Australia"], ["nz", "New Zealand"], ["ph", "Philippines"], ["id", "Indonesia"]],
    "Palestine and UN Zone": [["ps", "Palestine"], ["un", "United Nations"]],
    "Maldives": [["mv", "Maldives"]]
  };
  var GENERIC = [["globe", "Globe"]];

  // Loose matching so "usa / canada", "USA-Canada" or "Palestine & UN Zone" still map.
  function norm(s) {
    return String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  }
  var LOOKUP = {};
  Object.keys(STALL_FLAGS).forEach(function (k) { LOOKUP[norm(k)] = STALL_FLAGS[k]; });

  function parse(text) {
    var stalls = [];
    text.replace(/^\uFEFF/, "").split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line || line.charAt(0) === "#") return;
      var parts = line.split("|");
      var name = parts[0].trim();
      var url = parts.length > 1 ? parts[1].trim() : "";
      var mark = parts.length > 2 ? parts[2].trim() : "";
      if (!name) return;
      var full = mark.toLowerCase() === "full";
      if (url && !/^https:\/\/\S+$/i.test(url)) {
        console.warn("links.txt: ignoring invalid link for \"" + name + "\": " + url);
        url = "";
      }
      stalls.push({ name: name, url: url, full: full });
    });
    return stalls;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function tile(stall) {
    var flags = LOOKUP[norm(stall.name)] || GENERIC;
    var t;
    if (stall.full) {
      t = el("div", "tile full");
      t.setAttribute("aria-disabled", "true");
      t.setAttribute("aria-label", stall.name + " – team full, no more volunteers needed");
    } else if (stall.url) {
      t = el("a", "tile on");
      t.href = stall.url;
      t.target = "_blank";
      t.rel = "noopener noreferrer";
      t.setAttribute("aria-label", stall.name + " – join WhatsApp group");
    } else {
      t = el("div", "tile off");
      t.setAttribute("aria-disabled", "true");
      t.setAttribute("aria-label", stall.name + " – link coming soon");
    }

    var box = el("div", "flags n" + flags.length);
    flags.forEach(function (f) {
      var img = el("img");
      img.src = "flags/" + f[0] + ".svg";
      img.alt = f.length > 2 ? f[2] : f[1] + " flag";
      img.width = 640; img.height = 480;
      img.decoding = "async";
      box.appendChild(img);
    });
    t.appendChild(box);
    if (stall.full) t.appendChild(el("span", "ribbon", "TEAM FULL"));
    // Allow line breaks after "/" so "Singapore/Malaysia/Thailand" wraps cleanly.
    t.appendChild(el("div", "name", stall.name.replace(/\//g, "/\u200B")));
    var label = stall.full
      ? "Thank you! No more volunteers needed"
      : (stall.url ? "Join group \u2197" : "Link coming soon");
    t.appendChild(el("div", "label", label));

    var li = el("li");
    li.appendChild(t);
    return li;
  }

  function render(stalls) {
    var grid = document.getElementById("grid");
    var status = document.getElementById("status");
    grid.textContent = "";
    var frag = document.createDocumentFragment();
    stalls.forEach(function (s) { frag.appendChild(tile(s)); });
    grid.appendChild(frag);
    var open = 0, full = 0, soon = 0;
    stalls.forEach(function (s) {
      if (s.full) full++;
      else if (s.url) open++;
      else soon++;
    });
    status.className = "status";
    status.textContent = stalls.length
      ? open + " open \u00b7 " + full + " full \u00b7 " + soon + " coming soon"
      : "No stalls listed yet.";
  }

  function fail(err) {
    var status = document.getElementById("status");
    status.className = "status error";
    status.textContent = location.protocol === "file:"
      ? "Can't read links.txt when opened as a file. Serve the folder (e.g. python3 -m http.server) or host it online."
      : "Couldn't load the stall list. Please refresh, or message an organiser.";
    console.error(err);
  }

  function start() {
    fetch(LINKS_FILE, { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + LINKS_FILE);
        return r.text();
      })
      .then(function (txt) { render(parse(txt)); })
      .catch(fail);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
