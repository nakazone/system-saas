/* ObraMate Master — interactions (no framework). */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ---------- Toast ----------
  var toastEl = $("#toast");
  var toastTimer = null;
  function toast(msg, warn) {
    if (!toastEl || !msg) return;
    $("#toast-text").textContent = msg;
    toastEl.classList.toggle("warn", !!warn);
    var path = toastEl.querySelector("path");
    if (path) path.setAttribute("d", warn ? "M12 7v6M12 17h.01" : "M5 12l5 5 9-10");
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 4200);
  }
  try {
    var pending = sessionStorage.getItem("master-toast");
    if (pending) {
      sessionStorage.removeItem("master-toast");
      var t = JSON.parse(pending);
      toast(t.m, t.w);
    }
  } catch (e) { /* storage unavailable */ }
  function toastAfterReload(msg, warn) {
    try { sessionStorage.setItem("master-toast", JSON.stringify({ m: msg, w: !!warn })); } catch (e) { /* ignore */ }
  }

  // ---------- Mobile menu ----------
  var side = $(".side");
  $$("[data-menu]").forEach(function (b) {
    b.addEventListener("click", function (e) { e.stopPropagation(); side && side.classList.toggle("open"); });
  });
  document.addEventListener("click", function (e) {
    if (side && side.classList.contains("open") && !side.contains(e.target)) side.classList.remove("open");
  });

  // ---------- Dialogs ----------
  document.addEventListener("click", function (e) {
    var open = e.target.closest("[data-open]");
    if (open) {
      var d = document.getElementById(open.getAttribute("data-open"));
      if (d && d.showModal) { d.showModal(); var f = d.querySelector("[autofocus], input:not([type=hidden]):not([type=radio]):not([type=checkbox])"); if (f) f.focus(); }
      return;
    }
    var close = e.target.closest("[data-close]");
    if (close) { var dlg = close.closest("dialog"); if (dlg) dlg.close(); }
  });

  // ---------- Step-up (2FA again for sensitive actions) ----------
  var stepDialog = $("#stepup");
  var stepResolve = null;
  function askStepUp(label) {
    return new Promise(function (resolve) {
      if (!stepDialog) return resolve(false);
      $("#stepup-what").textContent = label || "Ação sensível";
      var input = $("#stepup-code");
      input.value = "";
      $("#stepup-error").hidden = true;
      stepResolve = resolve;
      stepDialog.showModal();
      input.focus();
    });
  }
  if (stepDialog) {
    var stepCode = $("#stepup-code");
    var stepBtn = $("#stepup-confirm");
    stepCode.addEventListener("input", function () {
      stepCode.value = stepCode.value.replace(/\D/g, "").slice(0, 6);
      stepBtn.disabled = stepCode.value.length !== 6;
      if (stepCode.value.length === 6) stepBtn.click();
    });
    $("#stepup-form").addEventListener("submit", function (e) {
      e.preventDefault();
      stepBtn.disabled = true;
      post("/master/step-up", new URLSearchParams({ code: stepCode.value })).then(function (r) {
        if (r.status === 200) {
          var res = stepResolve; stepResolve = null;
          stepDialog.close();
          if (res) res(true);
        } else {
          $("#stepup-error").textContent = (r.json && r.json.message) || "Código incorreto.";
          $("#stepup-error").hidden = false;
          stepCode.value = "";
          stepCode.focus();
        }
      });
    });
    stepDialog.addEventListener("close", function () { if (stepResolve) { var r = stepResolve; stepResolve = null; r(false); } });
  }

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Accept": "application/json", "X-Requested-With": "fetch", "Content-Type": "application/x-www-form-urlencoded" },
      body: body,
    }).then(function (r) {
      if (r.status === 401) { location.href = "/master/entrar?expirou=1"; return { status: 401, json: {} }; }
      var ct = r.headers.get("content-type") || "";
      if (ct.indexOf("text/csv") >= 0) return r.blob().then(function (b) { return { status: r.status, blob: b, name: (r.headers.get("content-disposition") || "").split("filename=")[1] }; });
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, json: j }; });
    });
  }

  // ---------- Reveal (one-time secrets) ----------
  var revealDialog = $("#reveal");
  function reveal(data, after) {
    if (!revealDialog) return after && after();
    $("#reveal-title").textContent = data.title || "";
    $("#reveal-value").textContent = data.value || "";
    $("#reveal-note").textContent = data.note || "";
    revealDialog.showModal();
    var copy = $("#reveal-copy");
    copy.onclick = function () {
      if (navigator.clipboard) navigator.clipboard.writeText(data.value || "").then(function () { copy.textContent = "Copiado"; });
    };
    copy.textContent = "Copiar";
    revealDialog.addEventListener("close", function once() { revealDialog.removeEventListener("close", once); if (after) after(); });
  }

  // ---------- Action forms ----------
  function submitAction(form, submitter) {
    var fd = new FormData(form);
    if (submitter && submitter.name) fd.append(submitter.name, submitter.value);
    var body = new URLSearchParams();
    fd.forEach(function (v, k) { body.append(k, v); });
    var btns = $$("button[type=submit], button:not([type])", form);
    btns.forEach(function (b) { b.disabled = true; });
    var url = form.getAttribute("action");
    var label = form.getAttribute("data-stepup") || "";
    function run() {
      return post(url, body).then(function (r) {
        if (r.status === 428) {
          return askStepUp(label).then(function (okd) { return okd ? run() : null; });
        }
        return r;
      });
    }
    run().then(function (r) {
      btns.forEach(function (b) { b.disabled = false; });
      if (!r) return;
      if (r.blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(r.blob);
        a.download = (r.name || "export.csv").replace(/"/g, "");
        document.body.appendChild(a); a.click(); a.remove();
        toast("Arquivo pronto. Fica registrado na auditoria.");
        return;
      }
      var j = r.json || {};
      if (!j.ok) { toast(j.message || "Não deu certo. Tente de novo.", true); return; }
      var dlg = form.closest("dialog");
      if (dlg) dlg.close();
      var go = function () {
        toastAfterReload(j.message, j.warn);
        if (j.redirect) location.href = j.redirect; else location.reload();
      };
      if (j.reveal) reveal(j.reveal, go); else go();
    }).catch(function () {
      btns.forEach(function (b) { b.disabled = false; });
      toast("Sem conexão. Tente de novo.", true);
    });
  }
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form.matches("form[data-action]")) return;
    e.preventDefault();
    var confirmText = form.getAttribute("data-confirm");
    if (confirmText && !window.confirm(confirmText)) return;
    submitAction(form, e.submitter);
  });

  // ---------- Drawer (company / user record) ----------
  var wrap = $("#drawer");
  var panel = $("#drawer-panel");
  var lastFocus = null;
  function openDrawer(kind, id, then) {
    if (!wrap) return;
    lastFocus = document.activeElement;
    wrap.hidden = false;
    document.body.style.overflow = "hidden";
    panel.innerHTML = '<div class="drawer-loading">Carregando…</div>';
    var url = (kind === "usuario" ? "/master/usuarios/" : "/master/clientes/") + encodeURIComponent(id) + "?partial=1";
    fetch(url, { credentials: "same-origin" }).then(function (r) {
      if (r.status === 401 || r.redirected) { location.href = "/master/entrar?expirou=1"; return ""; }
      return r.text();
    }).then(function (html) {
      panel.innerHTML = html;
      var params = new URLSearchParams(location.search);
      params.delete("ficha"); params.delete("usuario"); params.delete("abrir");
      params.set(kind === "usuario" ? "usuario" : "ficha", id);
      history.replaceState(null, "", location.pathname + "?" + params.toString());
      var c = panel.querySelector(".close-btn"); if (c) c.focus();
      initPanel(panel);
      if (then) then();
    });
  }
  function closeDrawer() {
    if (!wrap || wrap.hidden) return;
    wrap.hidden = true;
    document.body.style.overflow = "";
    var params = new URLSearchParams(location.search);
    params.delete("ficha"); params.delete("usuario"); params.delete("abrir");
    var q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : ""));
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-ficha], [data-usuario]");
    if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      if (a.hasAttribute("data-usuario")) openDrawer("usuario", a.getAttribute("data-usuario"));
      else openDrawer("cliente", a.getAttribute("data-ficha"));
      return;
    }
    if (e.target.closest("[data-drawer-close]")) closeDrawer();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && wrap && !wrap.hidden && !document.querySelector("dialog[open]")) closeDrawer();
  });
  (function fromUrl() {
    var p = new URLSearchParams(location.search);
    var abrir = p.get("abrir");
    var then = abrir ? function () { var d = document.getElementById("dlg-" + abrir); if (d && d.showModal) d.showModal(); } : null;
    if (p.get("ficha")) openDrawer("cliente", p.get("ficha"), then);
    else if (p.get("usuario")) openDrawer("usuario", p.get("usuario"), then);
    else if (then) then();
  })();

  // Panel helpers (also used by full pages)
  function initPanel(root) {
    $$("[data-due-preview]", root).forEach(function (box) {
      var form = box.closest("form");
      var base = box.getAttribute("data-base");
      var out = box.querySelector("b");
      var months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
      function fmt(d) { return d.getUTCDate() + " " + months[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
      function update() {
        var date = form.querySelector("[name=date]");
        if (date && date.value) { out.textContent = fmt(new Date(date.value + "T12:00:00Z")); return; }
        var r = form.querySelector("[name=days]:checked");
        if (!r) { out.textContent = "—"; return; }
        var d = new Date(base + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() + Number(r.value));
        out.textContent = fmt(d);
      }
      form.addEventListener("change", function (e) {
        if (e.target.name === "date" && e.target.value) $$("[name=days]", form).forEach(function (x) { x.checked = false; });
        if (e.target.name === "days") { var dt = form.querySelector("[name=date]"); if (dt) dt.value = ""; }
        update();
      });
      update();
    });
    $$("[data-plan-form]", root).forEach(function (form) {
      var prices = JSON.parse(form.getAttribute("data-prices"));
      var price = form.querySelector("[name=price]");
      function upd() {
        var p = form.querySelector("[name=plan]:checked"), c = form.querySelector("[name=cycle]:checked");
        if (p && c) price.placeholder = "Preço de tabela: " + prices[p.value][c.value];
      }
      form.addEventListener("change", upd); upd();
    });
  }
  initPanel(document);

  // ---------- Bulk selection (users) ----------
  var bulk = $("#bulkbar");
  if (bulk) {
    var boxes = $$(".js-sel");
    var all = $("#sel-all");
    var ids = $("#bulk-ids");
    var sync = function () {
      var picked = boxes.filter(function (b) { return b.checked; });
      bulk.hidden = picked.length === 0;
      $("#bulk-count").textContent = picked.length + " selecionado(s)";
      ids.value = picked.map(function (b) { return b.value; }).join(",");
      if (all) all.checked = picked.length > 0 && picked.length === boxes.length;
      boxes.forEach(function (b) { var row = b.closest(".tr"); if (row) row.classList.toggle("sel", b.checked); });
    };
    boxes.forEach(function (b) { b.addEventListener("change", sync); });
    if (all) all.addEventListener("change", function () { boxes.forEach(function (b) { b.checked = all.checked; }); sync(); });
    $("#bulk-clear").addEventListener("click", function () { boxes.forEach(function (b) { b.checked = false; }); sync(); });
  }

  // ---------- Live filter search (submit on pause) ----------
  $$("form[data-autosubmit] input[type=search]").forEach(function (inp) {
    var t = null;
    inp.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { inp.form.submit(); }, 450); });
  });

  // ---------- Command palette ----------
  var cmd = $("#cmdk");
  if (cmd) {
    var input = $("#cmdk-input");
    var list = $("#cmdk-list");
    var quick = list.innerHTML;
    var sel = 0;
    var timer = null;
    var openCmd = function () { input.value = ""; list.innerHTML = quick; sel = 0; mark(); cmd.showModal(); input.focus(); };
    $$("[data-cmdk]").forEach(function (b) { b.addEventListener("click", openCmd); });
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (!cmd.open) openCmd(); else cmd.close(); }
    });
    var items = function () { return $$(".cmdk-item", list); };
    var mark = function () { items().forEach(function (it, i) { it.setAttribute("aria-selected", i === sel ? "true" : "false"); }); };
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    input.addEventListener("input", function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { list.innerHTML = quick; sel = 0; mark(); return; }
      timer = setTimeout(function () {
        fetch("/master/busca?q=" + encodeURIComponent(q), { credentials: "same-origin", headers: { Accept: "application/json" } })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (input.value.trim() !== q) return;
            if (!j.groups || !j.groups.length) { list.innerHTML = '<div class="cmdk-empty">Nada encontrado para “' + esc(q) + '”.</div>'; return; }
            list.innerHTML = j.groups.map(function (g) {
              return '<div class="cmdk-group">' + esc(g.title) + "</div>" + g.items.map(function (it) {
                return '<a class="cmdk-item" role="option" href="' + esc(it.href) + '"><span class="ic"><svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="' + (it.kind === "Empresa" ? "M4 21V5l8-3 8 3v16M9 21v-4h6v4" : "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0") + '"></path></svg></span><span class="grow"><b>' + esc(it.label) + "</b><small>" + esc(it.sub) + "</small></span><em>" + esc(it.kind) + "</em></a>";
              }).join("");
            }).join("");
            sel = 0; mark();
          });
      }, 160);
    });
    input.addEventListener("keydown", function (e) {
      var its = items();
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(its.length - 1, sel + 1); mark(); its[sel] && its[sel].scrollIntoView({ block: "nearest" }); }
      if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); its[sel] && its[sel].scrollIntoView({ block: "nearest" }); }
      if (e.key === "Enter" && its[sel]) { e.preventDefault(); its[sel].click(); }
    });
    cmd.addEventListener("click", function (e) { if (e.target === cmd) cmd.close(); });
  }

  // ---------- Idle warning (server ends the session after 30 min) ----------
  var idleMs = 30 * 60 * 1000;
  var last = Date.now();
  ["click", "keydown"].forEach(function (ev) { document.addEventListener(ev, function () { last = Date.now(); }, true); });
  setInterval(function () {
    if (document.body.hasAttribute("data-auth")) return;
    if (Date.now() - last > idleMs) location.href = "/master/entrar?expirou=1";
  }, 30000);

  window.MasterUI = { toast: toast, openDrawer: openDrawer };
})();
