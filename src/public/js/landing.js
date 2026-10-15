(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (n) =>
    "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const toast = (m) => {
    const t = $("#toast");
    if (!t) return;
    t.textContent = m;
    t.classList.add("show");
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove("show"), 2200);
  };

  /* nav + progress */
  const nav = $("#nav");
  const prog = $("#progress");
  const links = $$('.nav-links a[href^="#"]');
  addEventListener(
    "scroll",
    () => {
      const h = document.documentElement;
      if (prog) prog.style.width = (h.scrollTop / (h.scrollHeight - h.clientHeight || 1)) * 100 + "%";
      nav?.classList.toggle("scrolled", h.scrollTop > 10);
      let cur = "";
      $$("section[id]").forEach((s) => {
        if (s.getBoundingClientRect().top < 140) cur = s.id;
      });
      links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + cur));
    },
    { passive: true },
  );
  const burger = $("#burger");
  burger?.addEventListener("click", () => {
    const open = $("#links")?.classList.toggle("open");
    burger.setAttribute("aria-expanded", open ? "true" : "false");
  });
  $$("#links a").forEach((a) =>
    a.addEventListener("click", () => {
      $("#links")?.classList.remove("open");
      burger?.setAttribute("aria-expanded", "false");
    }),
  );

  /* reveal */
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }),
    { threshold: 0.12 },
  );
  $$(".reveal").forEach((el) => {
    if (reduce) el.classList.add("in");
    else io.observe(el);
  });

  /* hero stage cycle */
  const cards = $$(".stage-card");
  const rails = $$(".stage-rail span");
  let si = 0;
  function showStage(i) {
    si = i % Math.max(cards.length, 1);
    cards.forEach((c, j) => c.classList.toggle("is-on", j === si));
    rails.forEach((r, j) => r.classList.toggle("is-on", j === si));
  }
  rails.forEach((r, i) =>
    r.addEventListener("click", () => {
      showStage(i);
      pauseStage();
    }),
  );
  let stagePause = 0;
  function pauseStage() {
    stagePause = Date.now() + 8000;
  }
  if (!reduce && cards.length) {
    setInterval(() => {
      if (Date.now() < stagePause) return;
      showStage(si + 1);
    }, 3200);
  }

  /* product tabs */
  const tabs = $$(".tab");
  const panes = $$(".pane");
  let ti = 0;
  let tTimer;
  function showTab(i) {
    ti = i;
    tabs.forEach((t, j) => {
      const on = j === i;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    panes.forEach((p, j) => p.classList.toggle("show", j === i));
    clearTimeout(tTimer);
    if (!reduce) tTimer = setTimeout(() => showTab((ti + 1) % tabs.length), 6500);
  }
  tabs.forEach((t, i) => t.addEventListener("click", () => showTab(i)));
  const tabsEl = $("#tabs");
  const stage = $("#productStage");
  [tabsEl, stage].forEach((el) => {
    if (!el) return;
    el.addEventListener("mouseenter", () => clearTimeout(tTimer));
    el.addEventListener("mouseleave", () => showTab(ti));
  });
  if (stage) {
    const tio = new IntersectionObserver(
      (es) => {
        if (es[0]?.isIntersecting) {
          showTab(0);
          tio.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    tio.observe(stage);
  }

  /* calculator */
  const FALLBACK_R = {
    hardwood: { w: 10, mm: 30, lm: 40, mr: 8.5, lr: 3.5 },
    lvp: { w: 8, mm: 35, lm: 40, mr: 4.25, lr: 2.75 },
    laminate: { w: 8, mm: 35, lm: 35, mr: 3.5, lr: 2.5 },
    tile: { w: 12, mm: 40, lm: 45, mr: 5.5, lr: 6 },
    carpet: { w: 10, mm: 30, lm: 35, mr: 2.75, lr: 1.5 },
  };
  const R =
    Array.isArray(window.__ESTIMATE_RULES__) && window.__ESTIMATE_RULES__.length
      ? Object.fromEntries(
          window.__ESTIMATE_RULES__.map((r) => [
            r.flooringType,
            {
              w: +r.wastePercent,
              mm: +r.materialMarkup,
              lm: +r.laborMarkup,
              mr: +r.defaultPricePerSqft,
              lr: +r.defaultLaborPerSqft,
            },
          ]),
        )
      : FALLBACK_R;
  const names = { hardwood: "Hardwood", lvp: "LVP", laminate: "Laminate", tile: "Tile", carpet: "Carpet" };
  let type = Object.keys(R)[0] || "hardwood";
  let rules = { ...(R[type] || FALLBACK_R.hardwood) };
  const typesEl = $("#types");
  if (typesEl) {
    Object.keys(R).forEach((k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "type" + (k === type ? " on" : "");
      b.innerHTML = `<div class="sw ${k}"></div>${names[k] || k}`;
      b.onclick = () => {
        type = k;
        rules = { ...R[k] };
        $$(".type").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        buildKnobs();
        calc();
      };
      typesEl.appendChild(b);
    });
  }
  const knobDefs = [
    ["w", "Waste", 0, 30, 1, "%"],
    ["mm", "Material markup", 0, 100, 1, "%"],
    ["lm", "Labor markup", 0, 100, 1, "%"],
    ["mr", "Material $/sqft", 0.5, 20, 0.25, "$"],
    ["lr", "Labor $/sqft", 0.5, 15, 0.25, "$"],
  ];
  function buildKnobs() {
    const k = $("#knobs");
    if (!k) return;
    k.innerHTML = "";
    knobDefs.forEach(([key, l, mn, mx, st, u]) => {
      const d = document.createElement("div");
      d.className = "knob";
      const lab = (v) => (u === "$" ? "$" + (+v).toFixed(2) : v + "%");
      d.innerHTML = `<label>${l}<b>${lab(rules[key])}</b></label><input type="range" min="${mn}" max="${mx}" step="${st}" value="${rules[key]}">`;
      const inp = d.querySelector("input");
      paint(inp);
      inp.oninput = () => {
        rules[key] = +inp.value;
        d.querySelector("b").textContent = lab(inp.value);
        paint(inp);
        calc();
      };
      k.appendChild(d);
    });
    const reset = document.createElement("button");
    reset.type = "button";
    reset.style.cssText = "grid-column:1/-1;justify-self:start;font-size:12.5px;font-weight:700;color:var(--brand-deep)";
    reset.textContent = "↺ Reset to defaults";
    reset.onclick = () => {
      rules = { ...R[type] };
      buildKnobs();
      calc();
      toast("Rules reset to " + (names[type] || type) + " defaults");
    };
    k.appendChild(reset);
  }
  function paint(r) {
    if (!r) return;
    r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min)) * 100 + "%");
  }
  const area = $("#area");
  const areaR = $("#areaR");
  if (area && areaR) {
    area.oninput = () => {
      areaR.value = Math.min(+area.value || 0, 3000);
      paint(areaR);
      calc();
    };
    areaR.oninput = () => {
      area.value = areaR.value;
      paint(areaR);
      calc();
    };
  }
  $$(".presets button").forEach((b) => {
    b.onclick = () => {
      if (!area || !areaR) return;
      area.value = areaR.value = b.dataset.a;
      paint(areaR);
      calc();
    };
  });
  const cur = { total: 0, mat: 0, lab: 0, bill: 0 };
  function tween(key, to, el, f) {
    if (!el) return;
    const from = cur[key];
    const t0 = performance.now();
    cur[key] = to;
    if (reduce) {
      el.textContent = f(to);
      return;
    }
    const st = (t) => {
      const p = Math.min((t - t0) / 450, 1);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = f(from + (to - from) * e);
      if (p < 1 && cur[key] === to) requestAnimationFrame(st);
    };
    requestAnimationFrame(st);
  }
  function calc() {
    if (!area) return;
    const a = Math.max(0, +area.value || 0);
    const bill = a * (1 + rules.w / 100);
    const mat = bill * rules.mr * (1 + rules.mm / 100);
    const lab = a * rules.lr * (1 + rules.lm / 100);
    const tot = mat + lab;
    tween("bill", bill, $("#billable"), (v) => v.toFixed(2) + " sqft");
    tween("mat", mat, $("#mat"), fmt);
    tween("lab", lab, $("#lab"), fmt);
    tween("total", tot, $("#total"), fmt);
    const per = $("#per");
    if (per) per.textContent = (a ? fmt(tot / a) : "$0.00") + " per sqft installed";
    const out = $("#outType");
    if (out) out.textContent = (names[type] || type) + " · " + a.toLocaleString() + " sqft";
    const sMat = $("#sMat");
    const sLab = $("#sLab");
    if (sMat) sMat.style.width = (tot ? (mat / tot) * 100 : 50) + "%";
    if (sLab) sLab.style.width = (tot ? (lab / tot) * 100 : 50) + "%";
  }
  if (areaR) paint(areaR);
  buildKnobs();
  calc();

  /* FAQ */
  const faqs = [
    [
      "Is my company’s data isolated?",
      "Yes. Every record is scoped to your organization. Tenant isolation is enforced in the application and with Postgres Row-Level Security.",
    ],
    [
      "What’s included in the free trial?",
      "The full workspace: leads, quotes, jobs, schedule, Campo, invoices, ObraCam, Folha, team roles, and builders pricing — for the trial period, no card required.",
    ],
    [
      "Can office and field use it together?",
      "Yes. Office runs quotes, jobs, and invoices. Crews open Campo tickets, log hours, and upload ObraCam photos on the same job.",
    ],
    [
      "Do invoices support deposits?",
      "Yes. From a job you can create a deposit, a custom amount, or the full balance — with services listed on the invoice.",
    ],
    [
      "Which flooring types work in estimates?",
      "Hardwood, LVP, laminate, tile, and carpet — each with waste and markup rules your company can edit.",
    ],
  ];
  const fq = $("#faqs");
  if (fq) {
    faqs.forEach(([q, a], i) => {
      const d = document.createElement("div");
      d.className = "faq-item" + (i === 0 ? " open" : "");
      d.innerHTML = `<button type="button" aria-expanded="${i === 0}">${q}<span class="pm" aria-hidden="true">+</span></button><div class="ans"><div><p>${a}</p></div></div>`;
      d.querySelector("button").onclick = () => {
        const o = d.classList.contains("open");
        $$(".faq-item").forEach((x) => {
          x.classList.remove("open");
          x.querySelector("button")?.setAttribute("aria-expanded", "false");
        });
        if (!o) {
          d.classList.add("open");
          d.querySelector("button")?.setAttribute("aria-expanded", "true");
        }
      };
      fq.appendChild(d);
    });
  }
})();
