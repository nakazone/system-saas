/* ObraMate Master — Comunicação (avisos no app + editor de modelos de e-mail). */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ---------- Character counters ----------
  $$("[data-count]").forEach(function (el) {
    var out = $('[data-count-for="' + el.id + '"]');
    if (!out) return;
    var max = Number(el.getAttribute("maxlength")) || 0;
    var sync = function () { out.textContent = max ? el.value.length + "/" + max : ""; };
    el.addEventListener("input", sync);
    sync();
  });

  // ---------- Notice form ----------
  var TONE = { info: "info", maintenance: "warn", urgent: "danger" };
  $$("form[data-ann-form]").forEach(function (form) {
    var preview = $("[data-ann-preview]", form);
    var picked = $("[data-org-picked]", form);
    function val(name) {
      var el = form.querySelector('[name="' + name + '"]:checked') || form.querySelector('[name="' + name + '"]');
      return el ? el.value : "";
    }
    function syncAudience() {
      var a = val("audience");
      $$("[data-aud]", form).forEach(function (box) { box.hidden = box.getAttribute("data-aud") !== a; });
      var n = $$('input[name="orgs"]:checked', form).length;
      if (picked) picked.textContent = n ? n + " empresa(s) escolhida(s)" : "Nenhuma empresa escolhida ainda";
    }
    function syncPreview() {
      if (!preview) return;
      var kind = val("kind") || "info";
      var title = val("title").trim() || "Título do aviso";
      var body = val("body").trim();
      var link = val("linkUrl").trim();
      var label = val("linkLabel").trim() || "Saiba mais";
      preview.className = "cm-ann-preview om-like t-" + (TONE[kind] || "info");
      preview.innerHTML = "";
      var ico = document.createElement("span");
      ico.className = "pv-ico";
      ico.textContent = kind === "info" ? "i" : "!";
      var text = document.createElement("span");
      text.className = "pv-text";
      var b = document.createElement("b");
      b.textContent = title;
      text.appendChild(b);
      if (body) { var p = document.createElement("span"); p.textContent = body; text.appendChild(p); }
      preview.appendChild(ico);
      preview.appendChild(text);
      if (link) { var c = document.createElement("span"); c.className = "pv-cta"; c.textContent = label; preview.appendChild(c); }
      if (kind !== "urgent") { var x = document.createElement("span"); x.className = "pv-x"; x.textContent = "×"; preview.appendChild(x); }
    }
    form.addEventListener("input", function () { syncAudience(); syncPreview(); });
    form.addEventListener("change", function () { syncAudience(); syncPreview(); });
    var filter = $("[data-org-filter]", form);
    if (filter) {
      filter.addEventListener("input", function () {
        var q = filter.value.trim().toLowerCase();
        $$("[data-org-list] label", form).forEach(function (l) { l.hidden = q && l.getAttribute("data-name").indexOf(q) < 0; });
      });
      filter.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });
    }
    syncAudience();
    syncPreview();
  });

  // ---------- E-mail template editor ----------
  var tpl = $("form[data-tpl-form]");
  if (tpl) {
    var body = $("[data-tpl-body]", tpl);
    var frame = $("[data-tpl-frame]");
    var subj = $("[data-tpl-subject]");
    var problem = $("[data-tpl-problem]", tpl);
    var lastFocus = body;
    $$("[data-tpl-field]", tpl).forEach(function (f) { f.addEventListener("focus", function () { lastFocus = f; }); });
    $$("[data-var]", tpl).forEach(function (chip) {
      chip.addEventListener("click", function () {
        var target = chip.getAttribute("data-var") === "button" ? body : lastFocus || body;
        if (target.readOnly) return;
        var token = "{{" + chip.getAttribute("data-var") + "}}";
        if (chip.getAttribute("data-var") === "button") token = "\n\n" + token + "\n\n";
        var s = target.selectionStart != null ? target.selectionStart : target.value.length;
        var e = target.selectionEnd != null ? target.selectionEnd : s;
        target.value = target.value.slice(0, s) + token + target.value.slice(e);
        target.focus();
        var pos = s + token.length;
        try { target.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
        schedule();
      });
    });
    var timer = null;
    var seq = 0;
    function refresh() {
      var my = ++seq;
      var data = new URLSearchParams(new FormData(tpl));
      fetch(tpl.getAttribute("data-preview-url"), {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: data,
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (my !== seq || !j || !j.ok) return;
          if (frame) frame.srcdoc = j.html;
          if (subj) subj.textContent = j.subject;
          if (problem) { problem.textContent = j.problem || ""; problem.hidden = !j.problem; }
        })
        .catch(function () {});
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 350); }
    tpl.addEventListener("input", schedule);
    // Fit the preview to its content.
    if (frame) {
      frame.addEventListener("load", function () {
        try { frame.style.height = Math.max(380, frame.contentDocument.documentElement.scrollHeight + 8) + "px"; } catch (e) { /* sandboxed */ }
      });
    }
  }

  // ---------- Privacy request form: person fields only for "Uma pessoa" ----------
  $$("form[data-pedido-form]").forEach(function (form) {
    var box = $("[data-person-only]", form);
    var sync = function () {
      var p = form.querySelector('input[name="subjectType"]:checked');
      if (box) box.hidden = !p || p.value !== "person";
    };
    form.addEventListener("change", sync);
    sync();
  });

  // ---------- Erase form: the button says how many groups are marked ----------
  $$("form[data-erase-form]").forEach(function (form) {
    var btn = form.querySelector("button[type=submit]");
    if (!btn) return;
    var base = btn.textContent;
    var sync = function () {
      var n = $$('input[name="cats"]:checked', form).length;
      var any = $$('input[name="cats"]:not([disabled])', form).length;
      btn.textContent = any ? (n ? base + " (" + n + " grupo" + (n > 1 ? "s" : "") + ")" : "Marque um grupo") : base;
      btn.disabled = any > 0 && n === 0;
    };
    form.addEventListener("change", sync);
    sync();
  });

  // ---------- Copy code ----------
  $$("[data-copy]").forEach(function (el) {
    el.title = "Clique para copiar";
    el.addEventListener("click", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(el.textContent.trim()).then(function () { if (window.MasterUI) window.MasterUI.toast("Copiado."); });
    });
  });
})();
