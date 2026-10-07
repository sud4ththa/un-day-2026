/* Builds a PDF of the stall dashboard from the counts already on the page.
   No network calls. Names, phone numbers, and emails are not read. */
(function () {
  "use strict";

  var PAGE_W = 595.28;
  var PAGE_H = 841.89;
  var MARGIN_X = 42;
  var MARGIN_TOP = 40;
  var MARGIN_BOTTOM = 62;
  var CONTENT_W = PAGE_W - MARGIN_X * 2;
  var INK = [0.067, 0.067, 0.067];
  var MUTE = [0.4, 0.4, 0.4];
  var ZERO = [0.541, 0.541, 0.541];
  var HAIR = [0.78, 0.78, 0.78];
  var TRACK = [0.9, 0.9, 0.9];

  /* Adobe Helvetica / Helvetica-Bold widths for codes 32–126, per 1000 em. */
  var REG = widths("278,278,355,556,556,889,667,222,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,222,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584");
  var BOLD = widths("278,333,474,556,556,889,722,278,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,278,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584");
  var SPECIAL = {
    "\u00B7": 278, "\u00F7": 584, "\u2013": 556, "\u2014": 1000,
    "\u2018": 222, "\u2019": 222, "\u201C": 333, "\u201D": 333,
    "\u2022": 350, "\u2026": 1000
  };
  var SPECIAL_BOLD = {
    "\u00B7": 278, "\u00F7": 584, "\u2013": 556, "\u2014": 1000,
    "\u2018": 278, "\u2019": 278, "\u201C": 500, "\u201D": 500,
    "\u2022": 350, "\u2026": 1000
  };
  var WIN = {
    "\u00B7": 0xB7, "\u00F7": 0xF7, "\u2013": 0x96, "\u2014": 0x97,
    "\u2018": 0x91, "\u2019": 0x92, "\u201C": 0x93, "\u201D": 0x94,
    "\u2022": 0x95, "\u2026": 0x85, "\u00A0": 0xA0
  };

  function widths(csv) {
    return csv.split(",").map(function (n) { return parseInt(n, 10); });
  }

  function fmt(n) {
    return (Math.round(n * 100) / 100).toString();
  }

  function glyphWidth(ch, font) {
    var special = font === "F2" ? SPECIAL_BOLD : SPECIAL;
    if (special[ch] != null) return special[ch];
    var code = ch.charCodeAt(0);
    var table = font === "F2" ? BOLD : REG;
    if (code >= 32 && code <= 126) return table[code - 32];
    return table[31]; /* question mark */
  }

  function measure(str, size, font, tracking) {
    var w = 0;
    var extra = tracking ? tracking * size : 0;
    for (var i = 0; i < str.length; i++) {
      w += glyphWidth(str.charAt(i), font) * size / 1000;
      if (extra && i < str.length - 1) w += extra;
    }
    return w;
  }

  function pdfStr(s) {
    var out = "(";
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var code = Object.prototype.hasOwnProperty.call(WIN, ch) ? WIN[ch] : ch.charCodeAt(0);
      if (code === 92 || code === 40 || code === 41) {
        out += "\\" + String.fromCharCode(code);
      } else if (code >= 32 && code <= 126) {
        out += String.fromCharCode(code);
      } else if (code >= 0 && code <= 255) {
        var oct = code.toString(8);
        while (oct.length < 3) oct = "0" + oct;
        out += "\\" + oct;
      } else {
        out += "?";
      }
    }
    return out + ")";
  }

  function showOp(str, tracking) {
    if (!tracking || str.length < 2) return pdfStr(str) + " Tj";
    var adjust = (-tracking * 1000).toFixed(2);
    var parts = [];
    for (var i = 0; i < str.length; i++) {
      parts.push(pdfStr(str.charAt(i)));
      if (i < str.length - 1) parts.push(adjust);
    }
    return "[ " + parts.join(" ") + " ] TJ";
  }

  function hardBreak(token, size, maxW, font, tracking) {
    var out = [];
    var buf = "";
    for (var i = 0; i < token.length; i++) {
      var trial = buf + token.charAt(i);
      if (buf && measure(trial, size, font, tracking) > maxW) {
        out.push(buf);
        buf = token.charAt(i);
      } else {
        buf = trial;
      }
    }
    if (buf) out.push(buf);
    return out;
  }

  function breakWord(word, size, maxW, font, tracking) {
    if (measure(word, size, font, tracking) <= maxW) return [word];
    if (word.indexOf("/") !== -1) {
      var bits = word.split("/");
      var out = [];
      var cur = "";
      for (var i = 0; i < bits.length; i++) {
        var piece = i < bits.length - 1 ? bits[i] + "/" : bits[i];
        var trial = cur + piece;
        if (!cur || measure(trial, size, font, tracking) <= maxW) cur = trial;
        else {
          if (cur) out.push(cur);
          cur = piece;
        }
      }
      if (cur) out.push(cur);
      var flat = [];
      for (var j = 0; j < out.length; j++) {
        if (measure(out[j], size, font, tracking) <= maxW) flat.push(out[j]);
        else flat = flat.concat(hardBreak(out[j], size, maxW, font, tracking));
      }
      return flat;
    }
    return hardBreak(word, size, maxW, font, tracking);
  }

  function wrap(text, size, maxW, font, tracking) {
    var clean = String(text || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    if (!clean) return [];
    var limit = Math.max(8, maxW - 0.75);
    var words = clean.split(" ");
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
      var pieces = breakWord(words[i], size, limit, font, tracking);
      for (var p = 0; p < pieces.length; p++) {
        var chunk = pieces[p];
        var trial = line ? line + " " + chunk : chunk;
        if (measure(trial, size, font, tracking) <= limit) line = trial;
        else {
          if (line) lines.push(line);
          line = chunk;
        }
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function plain(el) {
    if (!el) return "";
    var clone = el.cloneNode(true);
    var brs = clone.querySelectorAll("br");
    for (var i = 0; i < brs.length; i++) brs[i].replaceWith("\n");
    var wbrs = clone.querySelectorAll("wbr");
    for (var j = 0; j < wbrs.length; j++) wbrs[j].remove();
    return clone.textContent
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function Layout() {
    this.pages = [];
    this.ops = [];
    this.images = [];
    this.y = 0;
    this.section = "";
    this.pageIndex = -1;
    this.newPage();
  }

  Layout.prototype.cmd = function (s) { this.ops.push(s); };

  Layout.prototype.newPage = function () {
    if (this.pageIndex >= 0) this.pages.push(this.ops);
    this.ops = [];
    this.pageIndex += 1;
    if (this.pageIndex === 0) {
      this.y = PAGE_H - MARGIN_TOP;
      return;
    }
    var label = this.section ? "UN Day 2026  ·  " + this.section : "UN Day 2026  ·  Stall responses";
    label = fitWidth(label, 8, "F1", 0, CONTENT_W);
    this.text(label, MARGIN_X, PAGE_H - 28, { size: 8, font: "F1", color: MUTE });
    this.hline(MARGIN_X, MARGIN_X + CONTENT_W, PAGE_H - 34, HAIR, 0.6);
    this.y = PAGE_H - 48;
  };

  Layout.prototype.ensure = function (h) {
    if (this.y - h < MARGIN_BOTTOM && this.y < PAGE_H - 80) this.newPage();
  };

  Layout.prototype.gap = function (n) {
    if (this.y - n >= MARGIN_BOTTOM) this.y -= n;
  };

  Layout.prototype.text = function (str, x, y, opt) {
    if (!str) return;
    var size = opt.size;
    var font = opt.font || "F1";
    var color = opt.color || INK;
    this.cmd(color.map(fmt).join(" ") + " rg");
    this.cmd("BT");
    this.cmd("/" + font + " " + fmt(size) + " Tf");
    this.cmd("1 0 0 1 " + fmt(x) + " " + fmt(y) + " Tm");
    this.cmd(showOp(str, opt.tracking || 0));
    this.cmd("ET");
  };

  Layout.prototype.rect = function (x, y, w, h, color) {
    if (w <= 0.2 || h <= 0) return;
    this.cmd(color.map(fmt).join(" ") + " rg");
    this.cmd(fmt(x) + " " + fmt(y) + " " + fmt(w) + " " + fmt(h) + " re f");
  };

  Layout.prototype.hline = function (x1, x2, y, color, width) {
    this.cmd(color.map(fmt).join(" ") + " RG");
    this.cmd(fmt(width || 0.6) + " w");
    this.cmd(fmt(x1) + " " + fmt(y) + " m " + fmt(x2) + " " + fmt(y) + " l S");
  };

  Layout.prototype.strokeRect = function (x, y, w, h, color) {
    this.cmd(color.map(fmt).join(" ") + " RG");
    this.cmd("0.6 w");
    this.cmd(fmt(x) + " " + fmt(y) + " " + fmt(w) + " " + fmt(h) + " re S");
  };

  Layout.prototype.image = function (raster, x, y, w, h) {
    var idx = this.images.indexOf(raster);
    if (idx < 0) {
      idx = this.images.length;
      this.images.push(raster);
    }
    this.cmd("q");
    this.cmd(fmt(w) + " 0 0 " + fmt(h) + " " + fmt(x) + " " + fmt(y) + " cm");
    this.cmd("/Im" + (idx + 1) + " Do");
    this.cmd("Q");
  };

  function fitWidth(str, size, font, tracking, maxW) {
    if (measure(str, size, font, tracking) <= maxW) return str;
    var s = str;
    while (s.length > 1 && measure(s + "\u2026", size, font, tracking) > maxW) s = s.slice(0, -1);
    return s + "\u2026";
  }

  Layout.prototype.drawCentered = function (str, size, font, color, tracking) {
    var lines = wrap(str, size, CONTENT_W, font, tracking || 0);
    var lineH = size * 1.28;
    for (var i = 0; i < lines.length; i++) {
      this.ensure(lineH);
      var w = measure(lines[i], size, font, tracking || 0);
      var x = MARGIN_X + (CONTENT_W - w) / 2;
      this.text(lines[i], x, this.y - size * 0.78, {
        size: size, font: font, color: color, tracking: tracking || 0
      });
      this.y -= lineH;
    }
  };

  function rasterImage(img) {
    var w = img.naturalWidth;
    var h = img.naturalHeight;
    if (!w || !h) return null;
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    var data = ctx.getImageData(0, 0, w, h).data;
    var rgb = new Uint8Array(w * h * 3);
    for (var i = 0, j = 0; i < data.length; i += 4) {
      rgb[j++] = data[i];
      rgb[j++] = data[i + 1];
      rgb[j++] = data[i + 2];
    }
    return { w: w, h: h, rgb: rgb };
  }

  Layout.prototype.drawLogos = function (header) {
    var imgs = header.querySelectorAll(".logos img");
    var rasters = [];
    for (var i = 0; i < imgs.length; i++) {
      var raster = rasterImage(imgs[i]);
      if (raster) rasters.push(raster);
    }
    if (!rasters.length) return;
    var h = 36;
    var gap = 12;
    var widthsPx = rasters.map(function (r) { return h * r.w / r.h; });
    var total = widthsPx.reduce(function (a, b) { return a + b; }, 0) + (rasters.length > 1 ? gap * 2 + 0.7 : 0);
    var x = MARGIN_X + (CONTENT_W - total) / 2;
    var bottom = this.y - h;
    for (var n = 0; n < rasters.length; n++) {
      if (n === 1) {
        x += gap;
        this.rect(x, bottom + 6, 0.7, h - 12, [0.75, 0.75, 0.75]);
        x += 0.7 + gap;
      }
      this.image(rasters[n], x, bottom, widthsPx[n], h);
      x += widthsPx[n];
    }
    this.y = bottom - 14;
  };

  Layout.prototype.drawHeader = function (header) {
    try { this.drawLogos(header); } catch (e) { /* logos are optional */ }
    var kicker = plain(header.querySelector(".kicker")).toUpperCase();
    var title = plain(header.querySelector("h1"));
    var detail = plain(header.querySelector(".detail"));
    var meta = plain(header.querySelector(".meta"));
    if (kicker) this.drawCentered(kicker, 9, "F2", MUTE, 0.22);
    this.gap(8);
    if (title) this.drawCentered(title, 22, "F1", INK, 0);
    this.gap(4);
    if (detail) this.drawCentered(detail, 12, "F3", INK, 0);
    this.gap(6);
    var lines = meta.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s+|\s+$/g, "");
      if (line) this.drawCentered(line, 9, "F1", MUTE, 0);
    }
  };

  function colWidths(n) {
    var presets = {
      6: [186, 66, 60, 119, 40, 40.28],
      5: [214, 74, 66, 105, 52.28],
      4: [236, 84, 74, 117.28]
    };
    var preset = presets[n];
    if (!preset) {
      preset = [];
      var each = CONTENT_W / n;
      for (var i = 0; i < n; i++) preset.push(each);
    }
    var out = preset.slice();
    var sum = out.reduce(function (a, b) { return a + b; }, 0);
    out[out.length - 1] += CONTENT_W - sum;
    return out;
  }

  Layout.prototype.drawTableRow = function (cells, colW, font, size, opt) {
    var padX = 3;
    var lineH = size * 1.32;
    var wrapped = [];
    var nLines = 1;
    for (var i = 0; i < cells.length; i++) {
      var lines = wrap(cells[i], size, Math.max(8, colW[i] - padX * 2), font, 0);
      if (!lines.length) lines = [""];
      if (lines.length > nLines) nLines = lines.length;
      wrapped.push(lines);
    }
    var h = nLines * lineH + 8;
    this.ensure(h);
    if (opt.total) this.hline(MARGIN_X, MARGIN_X + CONTENT_W, this.y, INK, 0.9);
    var top = this.y;
    var x = MARGIN_X;
    for (var c = 0; c < wrapped.length; c++) {
      var right = c !== 0;
      for (var li = 0; li < wrapped[c].length; li++) {
        var line = wrapped[c][li];
        if (!line) continue;
        var tw = measure(line, size, font, 0);
        var tx = right ? x + colW[c] - padX - tw : x + padX;
        if (tx < x) tx = x;
        this.text(line, tx, top - 5 - size * 0.72 - li * lineH, { size: size, font: font, color: INK });
      }
      x += colW[c];
    }
    this.y = top - h;
    var strong = opt.header || opt.total;
    this.hline(MARGIN_X, MARGIN_X + CONTENT_W, this.y, strong ? INK : HAIR, strong ? 0.9 : 0.45);
  };

  Layout.prototype.drawTable = function (table) {
    var headers = Array.prototype.map.call(table.querySelectorAll("thead th"), function (th) {
      return plain(th).toUpperCase();
    });
    if (!headers.length) return;
    var colW = colWidths(headers.length);
    this.drawTableRow(headers, colW, "F2", 8, { header: true });
    var rows = table.querySelectorAll("tbody tr");
    for (var r = 0; r < rows.length; r++) {
      var cells = Array.prototype.map.call(rows[r].children, function (td) { return plain(td); });
      while (cells.length < headers.length) cells.push("");
      if (cells.length > headers.length) cells = cells.slice(0, headers.length);
      this.drawTableRow(cells, colW, rows[r].classList.contains("total") ? "F2" : "F1", 9.5, {
        total: rows[r].classList.contains("total")
      });
    }
    this.gap(4);
  };

  Layout.prototype.drawH2 = function (text) {
    if (!text) return;
    if (this.y - MARGIN_BOTTOM < 168 && this.y < PAGE_H - 90) this.newPage();
    this.section = text;
    this.gap(8);
    this.hline(MARGIN_X, MARGIN_X + CONTENT_W, this.y, INK, 1);
    this.gap(12);
    var lines = wrap(text, 16, CONTENT_W, "F1", 0);
    for (var i = 0; i < lines.length; i++) {
      this.ensure(20);
      this.text(lines[i], MARGIN_X, this.y - 14, { size: 16, font: "F1", color: INK });
      this.y -= 20;
    }
  };

  Layout.prototype.drawH3 = function (text) {
    if (!text) return;
    this.gap(11);
    var upper = text.toUpperCase();
    var lines = wrap(upper, 8.5, CONTENT_W, "F2", 0);
    for (var i = 0; i < lines.length; i++) {
      this.ensure(13);
      this.text(lines[i], MARGIN_X, this.y - 8.5, { size: 8.5, font: "F2", color: MUTE });
      this.y -= 13;
    }
    this.gap(3);
  };

  Layout.prototype.drawSub = function (text) {
    if (!text) return;
    this.gap(1);
    this.ensure(16);
    this.text(text, MARGIN_X, this.y - 11, { size: 11, font: "F3", color: [0.2, 0.2, 0.2] });
    this.y -= 15;
  };

  Layout.prototype.drawNote = function (text, color) {
    if (!text) return;
    this.gap(4);
    var lines = wrap(text, 9, CONTENT_W, "F1", 0);
    for (var i = 0; i < lines.length; i++) {
      this.ensure(13);
      this.text(lines[i], MARGIN_X, this.y - 9, { size: 9, font: "F1", color: color || MUTE });
      this.y -= 12;
    }
  };

  Layout.prototype.drawStats = function (dl) {
    var items = [];
    for (var i = 0; i < dl.children.length; i++) {
      var div = dl.children[i];
      if (div.tagName !== "DIV") continue;
      var dd = div.querySelector("dd");
      items.push({
        label: plain(div.querySelector("dt")).toUpperCase(),
        value: plain(dd),
        small: !!(dd && dd.classList.contains("small"))
      });
    }
    if (!items.length) return;
    this.gap(6);
    var cols = 3;
    var colW = CONTENT_W / cols;
    this.hline(MARGIN_X, MARGIN_X + CONTENT_W, this.y, HAIR, 0.6);
    for (var r = 0; r < items.length; r += cols) {
      var row = items.slice(r, r + cols);
      var labelLines = row.map(function (item) {
        return wrap(item.label, 8, colW - 8, "F2", 0.04);
      });
      var maxLabel = 1;
      for (var k = 0; k < labelLines.length; k++) {
        if (labelLines[k].length > maxLabel) maxLabel = labelLines[k].length;
      }
      var h = 12 + maxLabel * 10 + 20;
      this.ensure(h);
      for (var c = 0; c < row.length; c++) {
        var x = MARGIN_X + c * colW;
        var lines = labelLines[c];
        for (var li = 0; li < lines.length; li++) {
          this.text(lines[li], x, this.y - 12 - li * 10, {
            size: 8, font: "F2", color: MUTE, tracking: 0.04
          });
        }
        var vSize = row[c].small ? 11 : 15;
        var vFont = row[c].small ? "F3" : "F1";
        this.text(row[c].value, x, this.y - (14 + maxLabel * 10 + vSize * 0.72), {
          size: vSize, font: vFont, color: INK
        });
      }
      this.y -= h;
      this.hline(MARGIN_X, MARGIN_X + CONTENT_W, this.y, HAIR, 0.6);
    }
    this.gap(2);
  };

  Layout.prototype.drawBars = function (ul) {
    var parsed = [];
    var max = 1;
    for (var i = 0; i < ul.children.length; i++) {
      var li = ul.children[i];
      if (li.tagName !== "LI") continue;
      var raw = plain(li.querySelector(".n"));
      var count = parseInt(raw, 10);
      if (!isFinite(count)) count = 0;
      if (count > max) max = count;
      var labelEl = li.querySelector(".label");
      var label = plain(labelEl);
      parsed.push({ count: count, label: label, zero: li.classList.contains("zero") });
    }
    var size = 9.5;
    var countW = 32;
    for (var n = 0; n < parsed.length; n++) {
      var item = parsed[n];
      var lines = wrap(item.label, size, CONTENT_W - countW - 6, "F1", 0);
      if (!lines.length) lines = [""];
      var block = lines.length * 12.5 + 10;
      this.ensure(block);
      var color = item.zero ? ZERO : INK;
      for (var li = 0; li < lines.length; li++) {
        this.text(lines[li], MARGIN_X, this.y - 10 - li * 12.5, { size: size, font: "F1", color: color });
      }
      var num = String(item.count);
      var nw = measure(num, size, "F2", 0);
      this.text(num, MARGIN_X + CONTENT_W - nw, this.y - 10, { size: size, font: "F2", color: color });
      var barY = this.y - lines.length * 12.5 - 4;
      this.rect(MARGIN_X, barY, CONTENT_W, 3.2, TRACK);
      if (item.count > 0) {
        var bw = CONTENT_W * (item.count / max);
        if (bw < 1.6) bw = 1.6;
        this.rect(MARGIN_X, barY, bw, 3.2, INK);
      }
      this.y -= block;
      this.hline(MARGIN_X, MARGIN_X + CONTENT_W, this.y + 1, HAIR, 0.35);
    }
  };

  Layout.prototype.drawChips = function (ul) {
    var items = [];
    for (var i = 0; i < ul.children.length; i++) {
      var li = ul.children[i];
      if (li.tagName !== "LI") continue;
      var b = li.querySelector("b");
      var count = b ? plain(b) : "";
      var clone = li.cloneNode(true);
      var bolds = clone.querySelectorAll("b");
      for (var b = 0; b < bolds.length; b++) bolds[b].remove();
      items.push({ name: plain(clone), count: count });
    }
    if (!items.length) return;
    this.gap(2);
    var size = 9;
    var padX = 6;
    var boxH = 16;
    var gapX = 4;
    var rows = [];
    var row = [];
    var used = 0;
    for (var n = 0; n < items.length; n++) {
      var item = items[n];
      var nameW = measure(item.name, size, "F1", 0);
      var countW = item.count ? measure(item.count, size, "F2", 0) : 0;
      var w = padX + nameW + (item.count ? 5 + countW : 0) + padX;
      if (w > CONTENT_W) w = CONTENT_W;
      if (row.length && used + w > CONTENT_W) {
        rows.push(row);
        row = [];
        used = 0;
      }
      row.push({ item: item, w: w, nameW: nameW });
      used += w + gapX;
    }
    if (row.length) rows.push(row);
    for (var r = 0; r < rows.length; r++) {
      this.ensure(boxH + gapX);
      var x = MARGIN_X;
      var bottom = this.y - boxH;
      for (var c = 0; c < rows[r].length; c++) {
        var cell = rows[r][c];
        this.strokeRect(x, bottom, cell.w, boxH, [0.7, 0.7, 0.7]);
        var baseline = bottom + 4.5;
        this.text(cell.item.name, x + padX, baseline, { size: size, font: "F1", color: INK });
        if (cell.item.count) {
          this.text(cell.item.count, x + padX + cell.nameW + 5, baseline, { size: size, font: "F2", color: INK });
        }
        x += cell.w + gapX;
      }
      this.y -= boxH + gapX;
    }
  };

  Layout.prototype.renderBlock = function (el) {
    var tag = el.tagName;
    if (tag === "TABLE") this.drawTable(el);
    else if (tag === "H2") this.drawH2(plain(el));
    else if (tag === "H3") this.drawH3(plain(el));
    else if (tag === "P" && el.classList.contains("sub")) this.drawSub(plain(el));
    else if (tag === "P") this.drawNote(plain(el), el.classList.contains("off") ? INK : MUTE);
    else if (tag === "DL") this.drawStats(el);
    else if (tag === "UL" && el.classList.contains("bars")) this.drawBars(el);
    else if (tag === "UL" && el.classList.contains("chips")) this.drawChips(el);
  };

  Layout.prototype.renderSection = function (section) {
    var hasH2 = false;
    for (var i = 0; i < section.children.length; i++) {
      if (section.children[i].tagName === "H2") hasH2 = true;
    }
    if (!hasH2) {
      this.gap(2);
      this.hline(MARGIN_X, MARGIN_X + CONTENT_W, this.y, INK, 1);
      this.gap(8);
    }
    for (var j = 0; j < section.children.length; j++) this.renderBlock(section.children[j]);
  };

  Layout.prototype.finish = function (school) {
    this.pages.push(this.ops);
    var total = this.pages.length;
    var privacy = "Counts only. No names or contact details.";
    for (var i = 0; i < total; i++) {
      var ops = this.pages[i];
      ops.push(HAIR.map(fmt).join(" ") + " RG");
      ops.push("0.6 w");
      ops.push(fmt(MARGIN_X) + " 48 m " + fmt(MARGIN_X + CONTENT_W) + " 48 l S");
      ops.push(MUTE.map(fmt).join(" ") + " rg");
      ops.push("BT /F1 8 Tf 1 0 0 1 " + fmt(MARGIN_X) + " 34 Tm " + pdfStr(privacy) + " Tj ET");
      var pageLabel = "Page " + (i + 1) + " of " + total;
      var pw = measure(pageLabel, 8, "F1", 0);
      ops.push("BT /F1 8 Tf 1 0 0 1 " + fmt(MARGIN_X + CONTENT_W - pw) + " 34 Tm " + pdfStr(pageLabel) + " Tj ET");
      if (school) {
        var sw = measure(school, 8, "F1", 0);
        var sx = MARGIN_X + (CONTENT_W - sw) / 2;
        ops.push("BT /F1 8 Tf 1 0 0 1 " + fmt(sx) + " 20 Tm " + pdfStr(school) + " Tj ET");
      }
    }
    return this.pages.map(function (ops) { return ops.join("\n"); });
  };

  function pad10(n) {
    var s = String(n);
    while (s.length < 10) s = "0" + s;
    return s;
  }

  function encodeUtf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
    return out;
  }

  function ByteBuf() {
    this.parts = [];
    this.len = 0;
  }
  ByteBuf.prototype.str = function (s) {
    var b = encodeUtf8(s);
    this.parts.push(b);
    this.len += b.length;
  };
  ByteBuf.prototype.bytes = function (b) {
    this.parts.push(b);
    this.len += b.length;
  };
  ByteBuf.prototype.concat = function () {
    var out = new Uint8Array(this.len);
    var o = 0;
    for (var i = 0; i < this.parts.length; i++) {
      out.set(this.parts[i], o);
      o += this.parts[i].length;
    }
    return out;
  };

  function encodePdf(pageStreams, images) {
    var buf = new ByteBuf();
    var offsets = [0];
    function obj(id, bodyBytes) {
      offsets[id] = buf.len;
      buf.str(id + " 0 obj\n");
      if (typeof bodyBytes === "string") buf.str(bodyBytes);
      else buf.bytes(bodyBytes);
      buf.str("\nendobj\n");
    }
    buf.str("%PDF-1.4\n");
    buf.bytes(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    var n = pageStreams.length;
    var imageCount = images.length;
    var firstImage = 7;
    var firstPage = 7 + imageCount;
    var kids = [];
    for (var i = 0; i < n; i++) kids.push((firstPage + i * 2) + " 0 R");

    obj(1, "<< /Type /Catalog /Pages 2 0 R /PageLayout /OneColumn >>");
    obj(2, "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + n + " >>");
    obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    obj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");
    obj(6, "<< /Title (UN Day 2026 stall report) /Producer (UN Day stall dashboard) >>");

    for (var im = 0; im < imageCount; im++) {
      var image = images[im];
      var dict = "<< /Type /XObject /Subtype /Image /Width " + image.w +
        " /Height " + image.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length " +
        image.rgb.length + " >>\nstream\n";
      var head = encodeUtf8(dict);
      var tail = encodeUtf8("\nendstream");
      var body = new Uint8Array(head.length + image.rgb.length + tail.length);
      body.set(head, 0);
      body.set(image.rgb, head.length);
      body.set(tail, head.length + image.rgb.length);
      obj(firstImage + im, body);
    }

    var xobj = "";
    if (imageCount) {
      var names = [];
      for (var xn = 0; xn < imageCount; xn++) names.push("/Im" + (xn + 1) + " " + (firstImage + xn) + " 0 R");
      xobj = " /XObject << " + names.join(" ") + " >>";
    }
    var resources = "<< /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>" + xobj + " >>";

    for (var p = 0; p < n; p++) {
      var pageId = firstPage + p * 2;
      var contentId = pageId + 1;
      obj(pageId, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents " +
        contentId + " 0 R /Resources " + resources + " >>");
      var stream = pageStreams[p];
      obj(contentId, "<< /Length " + encodeUtf8(stream).length + " >>\nstream\n" + stream + "\nendstream");
    }

    var xrefAt = buf.len;
    var size = firstPage + n * 2;
    buf.str("xref\n0 " + size + "\n");
    buf.str(pad10(0) + " 65535 f \n");
    for (var id = 1; id < size; id++) {
      var off = offsets[id] || 0;
      buf.str(pad10(off) + " 00000 n \n");
    }
    buf.str("trailer\n<< /Size " + size + " /Root 1 0 R /Info 6 0 R >>\n");
    buf.str("startxref\n" + xrefAt + "\n%%EOF\n");
    return buf.concat();
  }

  function buildPdf(main, footerEl) {
    var layout = new Layout();
    var header = main.querySelector("header.top");
    if (header) layout.drawHeader(header);
    layout.gap(12);
    for (var i = 0; i < main.children.length; i++) {
      var el = main.children[i];
      if (el.tagName === "SECTION") layout.renderSection(el);
      else if (el.tagName === "P") layout.drawNote(plain(el), MUTE);
    }
    var school = plain(footerEl);
    var pages = layout.finish(school);
    return encodePdf(pages, layout.images);
  }

  function colomboDate() {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Colombo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
    } catch (e) {
      var d = new Date();
      function pad(n) { return (n < 10 ? "0" : "") + n; }
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
  }

  function anchorDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function savePdf(bytes, filename) {
    var blob = new Blob([bytes], { type: "application/pdf" });
    var ios = /iP(hone|ad|od)/.test(navigator.userAgent || "");
    if (ios && typeof File !== "undefined" && navigator.canShare) {
      try {
        var file = new File([blob], filename, { type: "application/pdf" });
        if (navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: filename }).catch(function (err) {
            if (!err || err.name !== "AbortError") anchorDownload(blob, filename);
          });
        }
      } catch (e) { /* fall through */ }
    }
    anchorDownload(blob, filename);
    return null;
  }

  var busy = false;
  function onClick() {
    if (busy) return;
    var btn = document.getElementById("download-pdf");
    var status = document.getElementById("pdf-status");
    busy = true;
    btn.disabled = true;
    if (status) status.textContent = "";
    var done = null;
    try {
      var main = document.querySelector("main");
      if (!main) throw new Error("missing report");
      var bytes = buildPdf(main, document.querySelector("footer"));
      done = savePdf(bytes, "UN-Day-2026-stall-report-" + colomboDate() + ".pdf");
    } catch (err) {
      if (status) status.textContent = "Could not create the PDF. Try again.";
    }
    Promise.resolve(done).then(function () {
      busy = false;
      btn.disabled = false;
    });
  }

  function init() {
    var btn = document.getElementById("download-pdf");
    if (!btn) return;
    btn.addEventListener("click", onClick);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})();
