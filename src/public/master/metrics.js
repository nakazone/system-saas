/* Master › Métricas — small SVG charts with hover/focus tooltips.
 * Palette (validated): single series = carvão #211d1a; two series = blue #3d6aa8 + terracota #c1652f.
 * Labels go in with textContent (never innerHTML). Every chart also has a table on the page. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var INK = "#211d1a", BLUE = "#3d6aa8", TERRA = "#c1652f", GRID = "#efe9df", AXIS = "#8a8076", SURFACE = "#ffffff";
  var dataEl = document.getElementById("mx-data");
  if (!dataEl) return;
  var data = JSON.parse(dataEl.textContent || "{}");

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function money(c) {
    var v = Math.round(c / 100);
    return "$" + v.toLocaleString("en-US");
  }
  function compact(c) {
    var v = c / 100;
    if (Math.abs(v) >= 1000) return "$" + (v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "K";
    return "$" + Math.round(v).toLocaleString("en-US");
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }

  // One tooltip for the page.
  var tip = document.createElement("div");
  tip.className = "mx-tip";
  tip.setAttribute("role", "status");
  tip.hidden = true;
  document.body.appendChild(tip);
  function showTip(evt, title, rows, anchor) {
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    var h = document.createElement("div");
    h.className = "mx-tip-title";
    h.textContent = title;
    tip.appendChild(h);
    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "mx-tip-row";
      if (r.color) {
        var k = document.createElement("i");
        k.style.background = r.color;
        row.appendChild(k);
      }
      var v = document.createElement("b");
      v.textContent = r.value;
      row.appendChild(v);
      var l = document.createElement("span");
      l.textContent = r.label;
      row.appendChild(l);
      tip.appendChild(row);
    });
    tip.hidden = false;
    var x, y;
    if (evt && evt.clientX != null) { x = evt.clientX; y = evt.clientY; }
    else { var b = anchor.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
    var w = tip.offsetWidth, hgt = tip.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 14));
    var top = y - hgt - 12 < 8 ? y + 16 : y - hgt - 12;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTip() { tip.hidden = true; }

  function bindHover(target, mark, title, rows) {
    target.setAttribute("tabindex", "0");
    target.setAttribute("aria-label", title + ": " + rows.map(function (r) { return r.label + " " + r.value; }).join(", "));
    function on(e) { mark.forEach(function (m) { m.classList.add("is-hover"); }); showTip(e, title, rows, target); }
    function off() { mark.forEach(function (m) { m.classList.remove("is-hover"); }); hideTip(); }
    target.addEventListener("pointermove", on);
    target.addEventListener("pointerleave", off);
    target.addEventListener("focus", on);
    target.addEventListener("blur", off);
  }

  /** Bar with 4px rounded data end and square baseline (upwards or downwards). */
  function barPath(x, y0, w, h, up) {
    var r = Math.min(4, w / 2, Math.abs(h));
    if (h <= 0) return "";
    if (up) {
      var top = y0 - h;
      return "M" + x + "," + y0 + "V" + (top + r) + "Q" + x + "," + top + " " + (x + r) + "," + top + "H" + (x + w - r) + "Q" + (x + w) + "," + top + " " + (x + w) + "," + (top + r) + "V" + y0 + "Z";
    }
    var bot = y0 + h;
    return "M" + x + "," + y0 + "V" + (bot - r) + "Q" + x + "," + bot + " " + (x + r) + "," + bot + "H" + (x + w - r) + "Q" + (x + w) + "," + bot + " " + (x + w) + "," + (bot - r) + "V" + y0 + "Z";
  }

  /** Columns over time. opts: { points:[{label,value,...}], color, diverging:{in,out}, fmt, height } */
  function columns(host, opts) {
    var W = host.clientWidth || 640, H = opts.height || 240;
    var padL = 46, padR = 8, padT = 14, padB = 26;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", height: H, "aria-hidden": "true" });
    host.appendChild(svg);
    var pts = opts.points, n = pts.length || 1;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var band = plotW / n, bw = Math.min(24, band * 0.62);
    var maxUp = 0, maxDown = 0;
    pts.forEach(function (p) {
      if (opts.diverging) { maxUp = Math.max(maxUp, p.in); maxDown = Math.max(maxDown, p.out); }
      else maxUp = Math.max(maxUp, p.value);
    });
    var top = niceMax(maxUp), bottom = opts.diverging ? niceMax(maxDown) : 0;
    if (opts.diverging && maxDown === 0) bottom = top * 0.25;
    var scale = plotH / (top + bottom);
    var y0 = padT + top * scale;
    // grid + ticks
    var ticks = [0, top / 2, top];
    if (opts.diverging && bottom) ticks.push(-bottom);
    ticks.forEach(function (t) {
      var y = y0 - t * scale;
      el("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: t === 0 ? "#d9d0c3" : GRID, "stroke-width": 1 }, svg);
      var tx = el("text", { x: padL - 8, y: y + 4, "text-anchor": "end", class: "mx-axis" }, svg);
      tx.textContent = (t < 0 ? "−" : "") + (opts.fmtAxis ? opts.fmtAxis(Math.abs(t)) : String(Math.abs(t)));
    });
    var every = Math.ceil(n / Math.max(1, Math.floor(plotW / 44)));
    pts.forEach(function (p, i) {
      var cx = padL + band * i + band / 2;
      var x = cx - bw / 2;
      var marks = [];
      if (opts.diverging) {
        var up = el("path", { d: barPath(x, y0 - 1, bw, p.in * scale, true), fill: BLUE, class: "mx-mark" + (p.estimated ? " is-est" : "") }, svg);
        var dn = el("path", { d: barPath(x, y0 + 1, bw, p.out * scale, false), fill: TERRA, class: "mx-mark" + (p.estimated ? " is-est" : "") }, svg);
        marks = [up, dn];
      } else {
        marks = [el("path", { d: barPath(x, y0, bw, p.value * scale, true), fill: opts.color || INK, class: "mx-mark" + (p.estimated ? " is-est" : "") + (i === n - 1 && opts.highlightLast ? " is-last" : "") }, svg)];
      }
      // Every Nth label plus the last one, skipping a regular one that would collide with the last.
      if ((i % every === 0 && n - 1 - i >= every) || i === n - 1) {
        var lt = el("text", { x: cx, y: H - 8, "text-anchor": "middle", class: "mx-axis" }, svg);
        lt.textContent = p.label;
      }
      var hit = el("rect", { x: padL + band * i, y: padT, width: band, height: plotH, fill: "transparent", class: "mx-hit" }, svg);
      bindHover(hit, marks, p.label + (p.estimated ? " (estimado)" : ""), opts.rows(p));
    });
    // Direct label on the last column (selective, not on every bar).
    if (opts.labelLast && n) {
      var last = pts[n - 1];
      var lx = padL + band * (n - 1) + band / 2;
      var anchorEnd = lx > W - 40;
      // When the label shifts left over the previous column, lift it above that column too.
      var topY = y0 - last.value * scale;
      if (anchorEnd && n > 1) topY = Math.min(topY, y0 - pts[n - 2].value * scale);
      var t = el("text", { x: anchorEnd ? W - padR : lx, y: topY - 6, "text-anchor": anchorEnd ? "end" : "middle", class: "mx-value" }, svg);
      t.textContent = opts.labelLast(last);
    }
  }

  /** Horizontal grouped bars (percent). */
  function hbars(host, items) {
    var W = host.clientWidth || 420;
    var rowH = 38, labelW = Math.min(118, W * 0.32), padR = 44;
    var H = items.length * rowH + 4;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", height: H, "aria-hidden": "true" });
    host.appendChild(svg);
    var plotW = W - labelW - padR;
    items.forEach(function (m, i) {
      var y = i * rowH + 4;
      var lt = el("text", { x: 0, y: y + 15, class: "mx-cat" }, svg);
      lt.textContent = m.label;
      var b1 = el("path", { d: hPath(labelW, y + 2, (m.d30 / 100) * plotW, 12), fill: BLUE, class: "mx-mark" }, svg);
      var b2 = el("path", { d: hPath(labelW, y + 16, (m.d7 / 100) * plotW, 12), fill: TERRA, class: "mx-mark" }, svg);
      el("line", { x1: labelW, x2: labelW, y1: y, y2: y + 30, stroke: "#d9d0c3", "stroke-width": 1 }, svg);
      var v = el("text", { x: labelW + (m.d30 / 100) * plotW + 6, y: y + 12, class: "mx-value-sm" }, svg);
      v.textContent = m.d30 + "%";
      var hit = el("rect", { x: 0, y: y, width: W, height: rowH - 4, fill: "transparent", class: "mx-hit" }, svg);
      bindHover(hit, [b1, b2], m.label, [
        { color: BLUE, value: m.d30 + "% (" + m.n30 + ")", label: "em 30 dias" },
        { color: TERRA, value: m.d7 + "% (" + m.n7 + ")", label: "em 7 dias" },
      ]);
    });
  }
  function hPath(x, y, w, h) {
    if (w <= 0) return "";
    var r = Math.min(4, w, h / 2);
    return "M" + x + "," + y + "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (y + h - r) + "Q" + (x + w) + "," + (y + h) + " " + (x + w - r) + "," + (y + h) + "H" + x + "Z";
  }

  function render() {
    ["chartMrr", "chartMove", "chartModules", "chartDaily"].forEach(function (id) {
      var h = document.getElementById(id);
      if (h) while (h.firstChild) h.removeChild(h.firstChild);
    });
    var mrr = document.getElementById("chartMrr");
    if (mrr) columns(mrr, {
      points: data.mrr,
      highlightLast: true,
      fmtAxis: compact,
      labelLast: function (p) { return money(p.value); },
      rows: function (p) { return [{ value: money(p.value), label: "MRR" }, { value: String(p.paying), label: "empresas pagando" }]; },
    });
    var mv = document.getElementById("chartMove");
    if (mv) columns(mv, {
      points: data.movement,
      diverging: true,
      fmtAxis: compact,
      rows: function (p) {
        return [
          { color: BLUE, value: money(p.in), label: "entrou" },
          { color: TERRA, value: money(p.out), label: "saiu" },
          { value: (p.net >= 0 ? "+" : "−") + money(Math.abs(p.net)), label: "líquido" },
        ];
      },
    });
    var md = document.getElementById("chartModules");
    if (md) hbars(md, data.modules);
    var dy = document.getElementById("chartDaily");
    if (dy) columns(dy, {
      points: data.daily,
      height: 170,
      fmtAxis: function (v) { return String(Math.round(v)); },
      rows: function (p) { return [{ value: String(p.value), label: "usuários ativos" }]; },
    });
  }
  render();
  var t;
  window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(render, 150); });
})();
