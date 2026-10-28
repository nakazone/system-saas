/**
 * Confirm dialog no padrão ObraMate (mesmo visual do Faturar job).
 * window.crmConfirm({ title, text, ok, cancel, danger }) → Promise<boolean>
 */
(function () {
  if (window.crmConfirm) return;

  const CSS_HREF = "crm-confirm.css?v=20261014-c1";

  function ensureCss() {
    if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => (l.getAttribute("href") || "").includes("crm-confirm.css"))) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function ensureDom() {
    let dlg = document.getElementById("crmConfirm");
    if (dlg) return dlg;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="crm-confirm-backdrop" id="crmConfirmBackdrop" hidden></div>
      <div class="crm-confirm" id="crmConfirm" role="alertdialog" aria-modal="true" aria-labelledby="crmConfirmTitle" aria-describedby="crmConfirmText" hidden>
        <h2 id="crmConfirmTitle"></h2>
        <p class="crm-confirm__text" id="crmConfirmText"></p>
        <div class="crm-confirm__foot">
          <button type="button" class="btn btn-secondary" id="crmConfirmCancel">Cancelar</button>
          <button type="button" class="btn btn-primary" id="crmConfirmOk">Confirmar</button>
        </div>
      </div>`;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    return document.getElementById("crmConfirm");
  }

  function crmConfirm(opts) {
    const o = opts || {};
    ensureCss();
    const dlg = ensureDom();
    const backdrop = document.getElementById("crmConfirmBackdrop");
    const titleEl = document.getElementById("crmConfirmTitle");
    const textEl = document.getElementById("crmConfirmText");
    const okBtn = document.getElementById("crmConfirmOk");
    const cancelBtn = document.getElementById("crmConfirmCancel");

    titleEl.textContent = o.title || "Confirmar?";
    textEl.textContent = o.text || "";
    textEl.hidden = !o.text;
    okBtn.textContent = o.ok || "Confirmar";
    cancelBtn.textContent = o.cancel || "Cancelar";
    okBtn.className = `btn ${o.danger ? "btn-danger" : "btn-primary"}`;

    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const finish = (value) => {
        dlg.classList.remove("is-open");
        backdrop.classList.remove("is-open");
        dlg.hidden = true;
        backdrop.hidden = true;
        document.body.classList.remove("crm-confirm-open");
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        backdrop.removeEventListener("click", onCancel);
        document.removeEventListener("keydown", onKey);
        if (prevFocus && typeof prevFocus.focus === "function") {
          try {
            prevFocus.focus();
          } catch (_) {}
        }
        resolve(value);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        } else if (e.key === "Enter" && document.activeElement !== cancelBtn) {
          e.preventDefault();
          finish(true);
        }
      };

      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      backdrop.addEventListener("click", onCancel);
      document.addEventListener("keydown", onKey);

      dlg.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add("crm-confirm-open");
      requestAnimationFrame(() => {
        dlg.classList.add("is-open");
        backdrop.classList.add("is-open");
        okBtn.focus();
      });
    });
  }

  /** Atalho tipado para concluir job — mesmo copy em lista, detalhe e mobile.
   *  opts.sector "installation" | "sand" fecha só aquele setor. */
  crmConfirm.completeJob = function completeJob(jobLabel, opts) {
    const name = String(jobLabel || "").trim();
    const sector = opts && opts.sector;
    if (sector === "installation") {
      return crmConfirm({
        title: name ? `Concluir instalação de “${name}”?` : "Concluir a instalação?",
        text: "A instalação fica pronta. A lixa continua em aberto até você concluir esse setor.",
        ok: "Concluir instalação",
        cancel: "Voltar",
      });
    }
    if (sector === "sand") {
      return crmConfirm({
        title: name ? `Concluir lixa de “${name}”?` : "Concluir a lixa?",
        text: "A lixa fica pronta e o job passa para Concluído.",
        ok: "Concluir lixa",
        cancel: "Voltar",
      });
    }
    return crmConfirm({
      title: name ? `Concluir “${name}”?` : "Concluir este job?",
      text: "O job passa para Concluído e fica disponível para faturar o que ainda falta.",
      ok: "Concluir job",
      cancel: "Voltar",
    });
  };

  window.crmConfirm = crmConfirm;
})();
