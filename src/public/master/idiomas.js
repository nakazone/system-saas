/* Master › Idiomas: term dialogs (reach preview), phrase editor, test box. */
(function () {
  "use strict";
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ---------- Terms: prefill + live reach ----------
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-term-open][data-prefill]");
    if (!b) return;
    var form = $("#" + b.getAttribute("data-open") + " form[data-term-form]");
    if (!form) return;
    try {
      var data = JSON.parse(b.getAttribute("data-prefill"));
      Object.keys(data).forEach(function (k) { if (form.elements[k]) form.elements[k].value = data[k]; });
      reach(form);
    } catch (_) {}
  });

  var timers = new WeakMap();
  function reach(form) {
    var box = $("[data-term-reach]", form);
    if (!box) return;
    var f = form.elements;
    var find = (f.find.value || "").trim();
    if (!find) { box.innerHTML = ""; return; }
    var qs = new URLSearchParams({
      idioma: form.getAttribute("data-locale") || "pt",
      find: find,
      replace: (f.replace.value || "").trim(),
      findPlural: (f.findPlural.value || "").trim(),
      replacePlural: (f.replacePlural.value || "").trim(),
      matchCase: f.matchCase.checked ? "1" : "0",
    });
    fetch("/master/idiomas/termos/alcance?" + qs.toString(), { credentials: "same-origin", headers: { Accept: "application/json", "X-Requested-With": "fetch" } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) { box.innerHTML = ""; return; }
        if (!j.count) {
          box.innerHTML = '<p class="muted">Nenhum texto do sistema tem essa palavra neste idioma (confira a grafia e os acentos).</p>';
          return;
        }
        box.innerHTML =
          "<p><b>" + j.count + "</b> texto(s) do sistema mudam. Exemplos:</p><ul>" +
          j.examples.map(function (x) { return "<li><span class=\"muted\">" + esc(x.before) + "</span><span aria-hidden=\"true\"> → </span><b>" + esc(x.after) + "</b></li>"; }).join("") +
          "</ul>";
      })
      .catch(function () { box.innerHTML = ""; });
  }
  $$("form[data-term-form]").forEach(function (form) {
    form.addEventListener("input", function () {
      clearTimeout(timers.get(form));
      timers.set(form, setTimeout(function () { reach(form); }, 250));
    });
    form.addEventListener("change", function () { reach(form); });
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-term-open]");
    if (!b) return;
    var form = $("#" + b.getAttribute("data-open") + " form[data-term-form]");
    if (form) setTimeout(function () { reach(form); }, 0);
  });

  // ---------- Phrases ----------
  var dlg = $("#dlg-phrase");
  function openPhrase(data, isNew) {
    if (!dlg) return;
    var form = $("form[data-phrase-form]", dlg);
    var reset = $("form[data-phrase-reset]", dlg);
    form.elements.custom.value = isNew ? "1" : "0";
    form.elements.source.value = isNew ? "" : data.source;
    $("[data-phrase-source-field]", dlg).style.display = isNew ? "" : "none";
    var view = $("[data-phrase-source-view]", dlg);
    view.style.display = isNew ? "none" : "";
    view.innerHTML = isNew ? "" : '<span class="muted">Texto no código</span><b>' + esc(data.source) + "</b>";
    $("[data-phrase-title]", dlg).textContent = isNew ? "Nova frase" : "Editar frase";
    $("[data-phrase-sub]", dlg).textContent = isNew
      ? "Para um texto que ainda não está traduzido. Escreva como aparece e a tradução de cada idioma."
      : "Vazio = volta ao texto padrão daquele idioma.";
    ["pt", "en", "es"].forEach(function (loc) {
      var ta = form.elements[loc];
      ta.value = isNew ? "" : data.values[loc];
      ta.placeholder = isNew ? "" : data.base[loc];
      var hint = $('[data-default="' + loc + '"]', dlg);
      hint.textContent = !isNew && data.edited.indexOf(loc) >= 0 ? "Padrão: " + data.base[loc] : "";
    });
    reset.style.display = isNew || !(data.edited && data.edited.length) ? "none" : "";
    reset.elements.source.value = isNew ? "" : data.source;
    if (dlg.showModal) dlg.showModal();
  }
  document.addEventListener("click", function (e) {
    var row = e.target.closest("[data-phrase]");
    if (row && !row.disabled) {
      try { openPhrase(JSON.parse(row.getAttribute("data-phrase")), false); } catch (_) {}
      return;
    }
    if (e.target.closest("[data-phrase-new]")) openPhrase(null, true);
  });
  $$("[data-autosubmit]").forEach(function (el) { el.addEventListener("change", function () { el.form.submit(); }); });

  // ---------- Test ----------
  var run = $("[data-test-run]");
  if (run) {
    run.addEventListener("click", function () {
      var text = $("[data-test-input]").value;
      if (!text.trim()) return;
      run.disabled = true;
      var body = new URLSearchParams({ text: text });
      fetch("/master/idiomas/testar", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json", "X-Requested-With": "fetch", "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.ok) return;
          var out = $("[data-test-out]");
          out.hidden = false;
          ["pt", "en", "es"].forEach(function (loc) { $('[data-out="' + loc + '"]', out).textContent = j.result[loc]; });
        })
        .catch(function () {})
        .then(function () { run.disabled = false; });
    });
  }
})();
