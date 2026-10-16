(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const toast = (m) => {
    const t = $("#toast");
    if (!t) return;
    t.textContent = m;
    t.classList.add("show");
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove("show"), 2400);
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
      nav?.classList.toggle("scrolled", h.scrollTop > 8);
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

  /* pricing toggle */
  const billBtns = $$(".bill-toggle button");
  function setBilling(mode) {
    billBtns.forEach((b) => b.classList.toggle("is-on", b.getAttribute("data-bill") === mode));
    $$(".price-card .amt").forEach((el) => {
      const val = el.getAttribute(mode === "year" ? "data-year" : "data-month") || "";
      const b = el.querySelector("b");
      if (b) b.textContent = val;
    });
  }
  billBtns.forEach((b) =>
    b.addEventListener("click", () => setBilling(b.getAttribute("data-bill") || "month")),
  );

  /* video placeholder */
  $("#videoPlay")?.addEventListener("click", () => {
    toast("Em breve: vídeo de demonstração do ObraMate.");
  });
})();
