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
      ".om-ro-card .om-ro-pay{background:#211d1a;color:#fff}.om-ro-card .om-ro-close{background:#ebe4d9;color:#211d1a}";
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
      '<div class="om-ro-card"><h2>Conta em modo só leitura</h2><p></p><div class="om-ro-row">' +
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

  // Any write refused with 402 ACCOUNT_READ_ONLY shows the same explanation.
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      return origFetch.apply(this, arguments).then(function (res) {
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
        document.documentElement.classList.toggle("om-read-only", state.mode === "read_only");
        renderBanner();
      })
      .catch(function () {});
  }

  window.__omAccount = { reload: load, readOnlyModal: readOnlyModal, state: state };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
  window.addEventListener("hashchange", renderBanner);
})();
