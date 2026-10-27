/**
 * Account status (billing) for every CRM page:
 *  - banner when the trial is ending, a payment failed or the account is read-only
 *  - friendly message when the server refuses a change because the account is read-only (402)
 * Loaded by crm-shell.js.
 */
(function () {
  if (window.__omAccountStatus) return;
  window.__omAccountStatus = true;

  var PLAN_URL = "configuracoes.html#plano";
  var state = { mode: "full", banner: null, canManage: false };

  function css() {
    if (document.getElementById("om-account-css")) return;
    var st = document.createElement("style");
    st.id = "om-account-css";
    st.textContent =
      ".om-acct{display:flex;align-items:center;gap:12px;padding:10px 16px;font:600 14px/1.4 'Plus Jakarta Sans',system-ui,sans-serif;border-radius:12px;margin:12px 16px 0;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}" +
      ".om-acct--info{background:#f6efe6;color:#3d3630}.om-acct--warn{background:#fdf0d5;color:#3d2a00}.om-acct--danger{background:#211d1a;color:#fff}" +
      ".om-acct__text{flex:1;min-width:0}.om-acct__cta{flex-shrink:0;border:0;border-radius:10px;height:36px;padding:0 14px;font:800 13px 'Plus Jakarta Sans',system-ui,sans-serif;cursor:pointer;background:#c1652f;color:#fff;text-decoration:none;display:inline-flex;align-items:center}" +
      ".om-acct--danger .om-acct__cta{background:#e8792c}.om-acct__x{border:0;background:transparent;color:inherit;font-size:20px;line-height:1;cursor:pointer;padding:4px 6px;opacity:.6}" +
      "@media (max-width:640px){.om-acct{margin:8px 10px 0;flex-wrap:wrap;font-size:13px}.om-acct__cta{width:100%;justify-content:center}}" +
      ".om-ro-modal{position:fixed;inset:0;z-index:2147483000;background:rgba(26,23,20,.45);display:flex;align-items:center;justify-content:center;padding:16px}" +
      ".om-ro-card{background:#f7f4ee;border-radius:20px;max-width:420px;width:100%;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.3);font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#211d1a}" +
      ".om-ro-card h2{margin:0 0 6px;font-size:20px;font-weight:800}.om-ro-card p{margin:0 0 16px;color:#6e655c;font-weight:500;line-height:1.5}" +
      ".om-ro-card .om-ro-row{display:flex;gap:8px}.om-ro-card button,.om-ro-card a{flex:1;height:44px;border-radius:12px;border:0;font:800 14px 'Plus Jakarta Sans',system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}" +
      ".om-ro-card .om-ro-pay{background:#211d1a;color:#fff}.om-ro-card .om-ro-close{background:#ebe4d9;color:#211d1a}" +
      ".om-lg-card{max-width:480px}.om-lg-card .om-lg-eyebrow{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#c1652f;margin:0 0 6px}" +
      ".om-lg-list{list-style:none;margin:0 0 14px;padding:0;border:1px solid #e2d9cc;border-radius:14px;background:#fff;overflow:hidden}" +
      ".om-lg-list li{display:flex;align-items:center;gap:10px;padding:12px 14px;border-top:1px solid #efe8dc;font-weight:700;font-size:14px}.om-lg-list li:first-child{border-top:0}" +
      ".om-lg-list li span{flex:1;min-width:0}.om-lg-list li small{display:block;font-weight:500;color:#6e655c;font-size:12px;margin-top:2px}" +
      ".om-lg-list a{flex:0 0 auto !important;height:32px !important;padding:0 12px;border-radius:9px !important;background:#f3efe6;color:#211d1a !important;font-size:13px !important}" +
      ".om-lg-new{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;background:#fdf0d5;color:#3d2a00;font-size:11px;font-weight:800;vertical-align:1px}" +
      ".om-lg-check{display:flex;gap:10px;align-items:flex-start;font-size:14px;font-weight:600;line-height:1.45;margin:0 0 16px;cursor:pointer}.om-lg-check input{width:18px;height:18px;margin:1px 0 0;accent-color:#211d1a;flex-shrink:0}" +
      ".om-lg-err{color:#a4401b;font-size:13px;font-weight:600;margin:-6px 0 12px;display:none}" +
      ".om-ro-card .om-lg-ok{background:#211d1a;color:#fff}.om-ro-card .om-lg-ok:disabled{opacity:.45;cursor:not-allowed}" +
      ".om-sup{position:fixed;left:0;right:0;top:0;z-index:2147482000;display:flex;align-items:center;gap:12px;padding:8px 16px;background:#a4401b;color:#fff;font:700 13px/1.35 'Plus Jakarta Sans',system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.18)}" +
      ".om-sup b{font-weight:800}.om-sup__t{flex:1;min-width:0}.om-sup__tag{background:rgba(255,255,255,.18);border-radius:999px;padding:2px 8px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;margin-right:8px}" +
      ".om-sup__x{flex-shrink:0;border:0;border-radius:9px;height:30px;padding:0 12px;background:#fff;color:#a4401b;font:800 12.5px 'Plus Jakarta Sans',system-ui,sans-serif;cursor:pointer}" +
      "html.om-support body{padding-top:var(--om-sup-h,46px) !important}html.om-support{outline:4px solid #a4401b;outline-offset:-4px}" +
      ".om-sup-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483001;background:#211d1a;color:#fff;border-radius:12px;padding:10px 14px;font:600 13.5px/1.4 'Plus Jakarta Sans',system-ui,sans-serif;max-width:min(92vw,460px);box-shadow:0 12px 30px rgba(0,0,0,.25)}" +
      "@media (max-width:640px){.om-sup{padding:8px 10px;font-size:12px}.om-sup__tag{display:none}}" +
      ".om-ann-wrap{display:flex;flex-direction:column;gap:8px;margin:12px 16px 0}.om-ann-wrap .om-acct{margin:0;align-items:flex-start}" +
      ".om-ann__ico{flex-shrink:0;width:22px;height:22px;margin-top:1px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font:800 13px/1 'Plus Jakarta Sans',system-ui,sans-serif}" +
      ".om-acct--info .om-ann__ico{background:#ebe1d3;color:#c1652f}.om-acct--warn .om-ann__ico{background:#f6dfae;color:#7a5200}.om-acct--danger .om-ann__ico{background:#e8792c;color:#fff}" +
      ".om-ann__t{display:block;font-weight:800}.om-ann__b{display:block;font-weight:500;margin-top:2px;white-space:pre-line}.om-acct--danger .om-ann__b{color:#f1e9df}" +
      ".om-ann .om-acct__cta{align-self:center}.om-ann .om-acct__x{align-self:flex-start;margin-top:-2px}" +
      "@media (max-width:640px){.om-ann-wrap{margin:8px 10px 0}}" +
      // The Mate (fox) explains plan status — calm, no pressure
      ".om-acct__mate{flex:none;width:28px;height:28px;border-radius:50%;overflow:hidden;background:#F1F3F5}.om-acct__mate img{display:block;width:100%;height:100%;object-fit:cover}" +
      ".om-ro-card .om-ro-mate{display:block;height:88px;width:auto;margin:-58px 0 6px}";
    document.head.appendChild(st);
  }

  function onPlanPage() {
    return /configuracoes\.html$/.test(location.pathname) && location.hash === "#plano";
  }

  function renderBanner() {
    var old = document.getElementById("omAccountBanner");
    if (old) old.remove();
    var b = state.banner;
    if (!b || onPlanPage()) return;
    var key = "om_acct_hide_" + b.text;
    try {
      if (b.tone === "info" && sessionStorage.getItem(key)) return;
    } catch (e) { /* ignore */ }
    css();
    var el = document.createElement("div");
    el.id = "omAccountBanner";
    el.className = "om-acct om-acct--" + b.tone;
    el.setAttribute("role", b.tone === "danger" ? "alert" : "status");
    var face = document.createElement("span");
    face.className = "om-acct__mate";
    face.setAttribute("aria-hidden", "true");
    face.innerHTML = '<img src="/assets/img/mascot/mate-head-' + (b.tone === "info" ? "neutral" : "curious") + '.webp?v=20261026-m1" alt="" width="28" height="28">';
    el.appendChild(face);
    var t = document.createElement("span");
    t.className = "om-acct__text";
    t.textContent = b.text + (b.cta && !state.canManage ? " Peça ao administrador da empresa." : "");
    el.appendChild(t);
    if (b.cta && state.canManage) {
      var a = document.createElement("a");
      a.className = "om-acct__cta";
      a.href = PLAN_URL;
      a.textContent = b.cta;
      el.appendChild(a);
    }
    if (b.tone === "info") {
      var x = document.createElement("button");
      x.className = "om-acct__x";
      x.type = "button";
      x.setAttribute("aria-label", "Fechar aviso");
      x.textContent = "×";
      x.onclick = function () {
        try { sessionStorage.setItem(key, "1"); } catch (e) { /* ignore */ }
        el.remove();
      };
      el.appendChild(x);
    }
    var host = document.querySelector(".dashboard-main") || document.querySelector("main") || document.body;
    host.insertBefore(el, host.firstChild);
  }

  var modalOpen = false;
  function readOnlyModal(message) {
    if (modalOpen) return;
    modalOpen = true;
    css();
    var wrap = document.createElement("div");
    wrap.className = "om-ro-modal";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML =
      '<div class="om-ro-card"><img class="om-ro-mate" src="/assets/img/mascot/mate-tablet.webp?v=20261026-m1" alt="" height="88"><h2>Conta em modo só leitura</h2><p></p><div class="om-ro-row">' +
      (state.canManage ? '<a class="om-ro-pay" href="' + PLAN_URL + '">Assinar agora</a>' : "") +
      '<button type="button" class="om-ro-close">Entendi</button></div></div>';
    wrap.querySelector("p").textContent =
      (message || "Sua conta está em modo só leitura. Seus dados continuam salvos.") +
      (state.canManage ? "" : " Peça ao administrador da empresa para assinar.");
    function close() {
      wrap.remove();
      modalOpen = false;
    }
    wrap.querySelector(".om-ro-close").onclick = close;
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    var f = wrap.querySelector(".om-ro-pay") || wrap.querySelector(".om-ro-close");
    if (f) f.focus();
  }


  // Terms / Privacy / DPA not accepted yet by this company (only admins see it).
  var legalOpen = false;
  function legalModal(legal) {
    if (legalOpen || !legal || !legal.pending || !legal.pending.length) return;
    try { if (sessionStorage.getItem("om_legal_later")) return; } catch (e) { /* ignore */ }
    legalOpen = true;
    css();
    var wrap = document.createElement("div");
    wrap.className = "om-ro-modal";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "omLgTitle");
    var names = { terms: "Termos de Serviço", privacy: "Política de Privacidade", dpa: "Acordo de Tratamento de Dados (DPA)" };
    var notes = { terms: "Regras de uso, plano, cobrança e cancelamento", privacy: "Como tratamos os dados da conta", dpa: "Como guardamos os dados dos seus clientes e funcionários" };
    var items = legal.docs.map(function (d) {
      return '<li><span>' + names[d.key] + (d.pending && !legal.first_time ? '<em class="om-lg-new">atualizado</em>' : "") +
        '<small>' + notes[d.key] + ' · em inglês</small></span><a href="' + d.url + '" target="_blank" rel="noopener">Ler ↗</a></li>';
    }).join("");
    wrap.innerHTML =
      '<div class="om-ro-card om-lg-card"><p class="om-lg-eyebrow">' + (legal.first_time ? "Antes de continuar" : "Termos atualizados") + '</p>' +
      '<h2 id="omLgTitle">' + (legal.first_time ? "Confirme os termos do ObraMate" : "Atualizamos nossos termos") + '</h2>' +
      '<p>' + (legal.first_time
        ? "Como administrador, confirme em nome da empresa os documentos que regem o uso do sistema e o cuidado com os dados."
        : "Leia o que mudou e confirme em nome da empresa para continuar.") + '</p>' +
      '<ul class="om-lg-list">' + items + '</ul>' +
      '<label class="om-lg-check"><input type="checkbox" id="omLgChk"> Li e aceito em nome da empresa.</label>' +
      '<p class="om-lg-err" id="omLgErr"></p>' +
      '<div class="om-ro-row"><button type="button" class="om-ro-close" id="omLgLater">Agora não</button><button type="button" class="om-lg-ok" id="omLgOk" disabled>Aceitar e continuar</button></div></div>';
    document.body.appendChild(wrap);
    var chk = wrap.querySelector("#omLgChk");
    var ok = wrap.querySelector("#omLgOk");
    var err = wrap.querySelector("#omLgErr");
    chk.addEventListener("change", function () { ok.disabled = !chk.checked; });
    function close() { wrap.remove(); legalOpen = false; }
    wrap.querySelector("#omLgLater").onclick = function () {
      try { sessionStorage.setItem("om_legal_later", "1"); } catch (e) { /* ignore */ }
      close();
    };
    ok.onclick = function () {
      ok.disabled = true;
      ok.textContent = "Salvando…";
      origFetch("/api/account/legal/accept", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); close(); })
        .catch(function () {
          ok.disabled = false;
          ok.textContent = "Aceitar e continuar";
          err.textContent = "Não foi possível salvar. Tente de novo.";
          err.style.display = "block";
        });
    };
    chk.focus();
  }

  // "Entrar como suporte": red bar on every page while ObraMate support is inside the account.
  var supTimer = null;
  function renderSupport(sup) {
    var old = document.getElementById("omSupportBar");
    if (old) old.remove();
    if (supTimer) { clearInterval(supTimer); supTimer = null; }
    document.documentElement.classList.toggle("om-support", !!sup);
    if (!sup) return;
    css();
    var bar = document.createElement("div");
    bar.id = "omSupportBar";
    bar.className = "om-sup";
    bar.setAttribute("role", "status");
    var t = document.createElement("span");
    t.className = "om-sup__t";
    var end = new Date(sup.expires_at).getTime();
    function text() {
      var left = Math.max(0, Math.ceil((end - Date.now()) / 60000));
      t.innerHTML = '<span class="om-sup__tag">Modo suporte</span>';
      t.appendChild(document.createTextNode(sup.admin + " vendo como " + sup.user + " · só leitura · termina em " + left + " min"));
      if (left <= 0) location.reload();
    }
    text();
    supTimer = setInterval(text, 30000);
    var x = document.createElement("button");
    x.type = "button";
    x.className = "om-sup__x";
    x.textContent = "Sair do suporte";
    x.onclick = function () {
      x.disabled = true;
      origFetch("/api/support-session/exit", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          if (j && j.restored) location.href = "/";
          else document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font:600 16px system-ui;color:#211d1a;background:#f7f4ee">Sessão de suporte encerrada. Pode fechar esta aba.</div>';
        });
    };
    bar.appendChild(t);
    bar.appendChild(x);
    document.body.appendChild(bar);
    // Push down whatever the page pins to the top (app bar, sticky headers) so the red bar never hides it.
    function offsetTopBars() {
      var h = bar.offsetHeight || 46;
      document.documentElement.style.setProperty("--om-sup-h", h + "px");
      Array.prototype.forEach.call(document.body.querySelectorAll("*"), function (el) {
        if (el === bar || bar.contains(el) || el.dataset.omSupShift) return;
        var cs = getComputedStyle(el);
        if ((cs.position === "fixed" || cs.position === "sticky") && parseFloat(cs.top) < h && cs.top !== "auto" && el.offsetHeight < window.innerHeight * 0.5) {
          el.dataset.omSupShift = "1";
          el.style.setProperty("top", (parseFloat(cs.top) + h) + "px", "important");
        }
      });
    }
    offsetTopBars();
    setTimeout(offsetTopBars, 800);
    setTimeout(offsetTopBars, 2500);
  }

  // Scheduled maintenance within 24 h: info banner (dismissible for the session).
  function renderMaintenance(n) {
    var old = document.getElementById("omMaintBanner");
    if (old) old.remove();
    if (!n || !n.at) return;
    var key = "om_maint_hide_" + n.at;
    try { if (sessionStorage.getItem(key)) return; } catch (e) { /* ignore */ }
    css();
    var when = new Date(n.at);
    var txt = "Manutenção programada " + when.toLocaleString("pt-BR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + ". O sistema fica fora do ar por alguns minutos." + (n.note ? " " + n.note : "");
    var el = document.createElement("div");
    el.id = "omMaintBanner";
    el.className = "om-acct om-acct--info";
    el.setAttribute("role", "status");
    var t = document.createElement("span");
    t.className = "om-acct__text";
    t.textContent = txt;
    el.appendChild(t);
    var x = document.createElement("button");
    x.className = "om-acct__x";
    x.type = "button";
    x.setAttribute("aria-label", "Fechar aviso");
    x.textContent = "×";
    x.onclick = function () { try { sessionStorage.setItem(key, "1"); } catch (e) { /* ignore */ } el.remove(); };
    el.appendChild(x);
    var host = document.querySelector(".dashboard-main") || document.querySelector("main") || document.body;
    host.insertBefore(el, host.firstChild);
  }

  // Avisos da plataforma (Master › Comunicação). Urgent ones can't be closed; closing is saved per user.
  var ANN_TONE = { info: "info", maintenance: "warn", urgent: "danger" };
  var ANN_ICO = { info: "i", maintenance: "!", urgent: "!" };
  function renderAnnouncements(list, inSupport) {
    var old = document.getElementById("omAnnouncements");
    if (old) old.remove();
    list = (list || []).filter(function (a) { return a && a.id; });
    if (!list.length) return;
    css();
    var wrap = document.createElement("div");
    wrap.id = "omAnnouncements";
    wrap.className = "om-ann-wrap";
    list.forEach(function (a) {
      var el = document.createElement("div");
      el.className = "om-acct om-ann om-acct--" + (ANN_TONE[a.kind] || "info");
      el.setAttribute("role", a.kind === "urgent" ? "alert" : "status");
      el.setAttribute("data-ann", a.id);
      var ico = document.createElement("span");
      ico.className = "om-ann__ico";
      ico.setAttribute("aria-hidden", "true");
      ico.textContent = ANN_ICO[a.kind] || "i";
      el.appendChild(ico);
      var t = document.createElement("span");
      t.className = "om-acct__text";
      var b = document.createElement("span");
      b.className = "om-ann__t";
      b.textContent = a.title;
      t.appendChild(b);
      if (a.body) {
        var p = document.createElement("span");
        p.className = "om-ann__b";
        p.textContent = a.body;
        t.appendChild(p);
      }
      el.appendChild(t);
      if (a.link_url && /^(https?:\/\/|\/)/.test(a.link_url)) {
        var l = document.createElement("a");
        l.className = "om-acct__cta";
        l.href = a.link_url;
        if (/^https?:/.test(a.link_url)) { l.target = "_blank"; l.rel = "noopener"; }
        l.textContent = a.link_label || "Saiba mais";
        el.appendChild(l);
      }
      if (a.dismissible && !inSupport) {
        var x = document.createElement("button");
        x.className = "om-acct__x";
        x.type = "button";
        x.setAttribute("aria-label", "Fechar aviso");
        x.textContent = "×";
        x.onclick = function () {
          el.remove();
          if (!wrap.children.length) wrap.remove();
          origFetch("/api/account/announcements/" + encodeURIComponent(a.id) + "/dismiss", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(function () {});
        };
        el.appendChild(x);
      }
      wrap.appendChild(el);
    });
    var host = document.querySelector(".dashboard-main") || document.querySelector("main") || document.body;
    host.insertBefore(wrap, host.firstChild);
  }

  // Uncaught browser errors go to Master › Operação (max 5 per page; noise ignored).
  var errSent = 0;
  var IGNORE = /^(Script error\.?|ResizeObserver loop|Non-Error promise rejection)/i;
  function reportError(message, source, line) {
    if (!message || errSent >= 5 || IGNORE.test(String(message))) return;
    errSent++;
    try {
      origFetch("/api/client-errors", {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: String(message).slice(0, 500), source: String(source || "").split("?")[0].slice(0, 160), line: line || 0, page: location.pathname }),
      }).catch(function () {});
    } catch (e) { /* ignore */ }
  }
  window.addEventListener("error", function (e) {
    if (e && e.message) reportError(e.message, e.filename, e.lineno);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    reportError(r && r.message ? r.message : String(r || ""), r && r.stack ? String(r.stack).split("\n")[1] : "", 0);
  });

  // Modules outside the company's plan: hide every link to their pages (dock, menu, tab bar, shortcuts).
  function hidePages(pages) {
    var old = document.getElementById("om-plan-hide");
    if (old) old.remove();
    pages = (pages || []).filter(function (p) { return /^[a-z0-9-]+\.html$/.test(p); });
    if (!pages.length) return;
    var sel = [];
    // ":not(#…)" raises specificity above the dock/menu rules that force display with !important.
    var boost = ":not(#om-x):not(#om-y)";
    pages.forEach(function (p) {
      ['="' + p + '"', '="/' + p + '"', '^="' + p + '?"', '^="/' + p + '?"', '^="' + p + '#"', '^="/' + p + '#"'].forEach(function (m) {
        sel.push("a[href" + m + "]" + boost);
      });
    });
    var st = document.createElement("style");
    st.id = "om-plan-hide";
    st.textContent = sel.join(",") + "{display:none !important}";
    document.head.appendChild(st);
  }

  var toastTimer = null;
  function supportToast(msg) {
    var el = document.getElementById("omSupToast");
    if (!el) {
      css();
      el = document.createElement("div");
      el.id = "omSupToast";
      el.className = "om-sup-toast";
      el.setAttribute("role", "alert");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.remove(); }, 4500);
  }

  // Any write refused with 402 ACCOUNT_READ_ONLY shows the same explanation.
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      return origFetch.apply(this, arguments).then(function (res) {
        if (res && (res.status === 403 || res.status === 401) && document.documentElement.classList.contains("om-support")) {
          res.clone().json().then(function (j) {
            if (!j) return;
            if (j.error === "SUPPORT_READ_ONLY" || j.error === "SUPPORT_HIDDEN") supportToast(j.message);
            else if (j.error === "SUPPORT_ENDED") location.reload();
          }).catch(function () {});
        }
        if (res && res.status === 402) {
          res.clone().json().then(function (j) {
            if (j && j.error === "ACCOUNT_READ_ONLY") readOnlyModal(j.message);
          }).catch(function () {});
        }
        return res;
      });
    };
  }

  function load() {
    origFetch("/api/account/status", { credentials: "include", cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.success) return;
        state.mode = j.data.mode;
        state.banner = j.data.banner;
        state.canManage = !!j.data.can_manage_billing;
        renderSupport(j.data.support || null);
        hidePages(j.data.hidden_pages || []);
        renderMaintenance(j.data.maintenance_notice || null);
        renderAnnouncements(j.data.announcements || [], !!j.data.support);
        document.documentElement.classList.toggle("om-read-only", state.mode === "read_only");
        renderBanner();
        legalModal(j.data.legal);
      })
      .catch(function () {});
  }

  window.__omAccount = { reload: load, readOnlyModal: readOnlyModal, state: state, hidePages: hidePages, renderAnnouncements: renderAnnouncements };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
  window.addEventListener("hashchange", renderBanner);
})();
