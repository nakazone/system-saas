/**
 * Loading placeholders shaped like the content that is coming (Doherty threshold:
 * the screen answers at once and nothing jumps when data arrives).
 *
 *   crmSkeleton.rows(6)                  → HTML string: list rows (avatar + two lines + value)
 *   crmSkeleton.rows(6, { avatar: false })
 *   crmSkeleton.cards(3)                 → HTML string: KPI / summary cards
 *   crmSkeleton.tableRows(5, 4)          → HTML string: <tr> rows with 4 cells
 *   crmSkeleton.fill(el, "rows", 6)      → puts placeholders in el and marks it aria-busy
 *   crmSkeleton.error(el, message, onRetry) → inline error with "Tentar de novo"
 *
 * Use these instead of a "Carregando…" line. Styles live in om-theme.css (.om-skel*).
 * The server injects this file on every CRM page.
 */
(function () {
  if (window.crmSkeleton) return;

  function repeat(n, fn) {
    let out = "";
    for (let i = 0; i < n; i++) out += fn(i);
    return out;
  }

  // Vary line widths so the block reads as text, not as a grid of bars.
  const W1 = ["62%", "48%", "70%", "55%", "66%", "50%"];
  const W2 = ["38%", "44%", "30%", "41%", "35%", "46%"];

  function rows(n, opts) {
    const o = opts || {};
    const avatar = o.avatar !== false;
    return (
      '<div class="om-skel-list" aria-hidden="true">' +
      repeat(n || 6, (i) =>
        '<div class="om-skel-row">' +
        (avatar ? '<span class="om-skel om-skel--circle"></span>' : "") +
        '<span class="om-skel-row__lines">' +
        `<span class="om-skel om-skel--line" style="width:${W1[i % W1.length]}"></span>` +
        `<span class="om-skel om-skel--line om-skel--sm" style="width:${W2[i % W2.length]}"></span>` +
        "</span>" +
        '<span class="om-skel om-skel--value"></span>' +
        "</div>",
      ) +
      "</div>"
    );
  }

  function cards(n) {
    return (
      '<div class="om-skel-cards" aria-hidden="true">' +
      repeat(n || 3, () =>
        '<div class="om-skel-card">' +
        '<span class="om-skel om-skel--line om-skel--sm" style="width:45%"></span>' +
        '<span class="om-skel om-skel--line om-skel--lg" style="width:65%"></span>' +
        "</div>",
      ) +
      "</div>"
    );
  }

  function tableRows(n, cols) {
    const c = cols || 4;
    return repeat(n || 5, (i) =>
      '<tr class="om-skel-tr" aria-hidden="true">' +
      repeat(c, (j) => `<td><span class="om-skel om-skel--line" style="width:${j === 0 ? W1[i % W1.length] : "60%"}"></span></td>`) +
      "</tr>",
    );
  }

  function fill(el, kind, n, opts) {
    if (!el) return;
    const k = kind || "rows";
    el.innerHTML = k === "cards" ? cards(n) : k === "table" ? tableRows(n, opts && opts.cols) : rows(n, opts);
    el.setAttribute("aria-busy", "true");
    // Screen readers still get a word for it.
    const sr = document.createElement("span");
    sr.className = "om-skel-sr";
    sr.textContent = "Carregando";
    el.appendChild(sr);
  }

  function done(el) {
    if (el) el.removeAttribute("aria-busy");
  }

  function error(el, message, onRetry) {
    if (!el) return;
    el.removeAttribute("aria-busy");
    el.innerHTML = "";
    const box = document.createElement("div");
    box.className = "om-load-error";
    box.setAttribute("role", "alert");
    const p = document.createElement("p");
    p.textContent = message || "Não foi possível carregar.";
    box.appendChild(p);
    if (typeof onRetry === "function") {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "om-load-error__retry";
      b.textContent = "Tentar de novo";
      b.addEventListener("click", onRetry);
      box.appendChild(b);
    }
    el.appendChild(box);
  }

  window.crmSkeleton = { rows, cards, tableRows, fill, done, error };
})();
