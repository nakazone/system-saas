/**
 * Diálogos no padrão ObraMate (mesmo visual do Faturar job). No celular viram painel de baixo.
 * window.crmConfirm({ title, text, ok, cancel, danger }) → Promise<boolean>
 * window.crmPrompt({ title, text, label, value, placeholder, ok, cancel, type, options, required, inputMode })
 *   → Promise<string|null>   (type: "text" | "number" | "textarea" | "select"; null = cancelado)
 * window.crmShare({ url, title, text }) → Promise<void>  (folha de compartilhar do sistema, ou copia o link)
 * Use estes no lugar de window.confirm / window.prompt.
 */
(function () {
  if (window.crmPrompt) return;

  const CSS_HREF = "/crm-confirm.css?v=20261104-ux2";

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


  function ensurePromptDom() {
    let dlg = document.getElementById("crmPrompt");
    if (dlg) return dlg;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="crm-confirm-backdrop" id="crmPromptBackdrop" hidden></div>
      <form class="crm-confirm crm-prompt" id="crmPrompt" role="dialog" aria-modal="true" aria-labelledby="crmPromptTitle" hidden novalidate>
        <h2 id="crmPromptTitle"></h2>
        <p class="crm-confirm__text" id="crmPromptText"></p>
        <label class="crm-prompt__label" id="crmPromptLabel" for="crmPromptField"></label>
        <div class="crm-prompt__field" id="crmPromptFieldWrap"></div>
        <p class="crm-prompt__error" id="crmPromptError" role="alert" hidden></p>
        <div class="crm-confirm__foot">
          <button type="button" class="btn btn-secondary" id="crmPromptCancel">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="crmPromptOk">Salvar</button>
        </div>
      </form>`;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    return document.getElementById("crmPrompt");
  }

  function buildField(o) {
    const type = o.type || "text";
    let field;
    if (type === "textarea") {
      field = document.createElement("textarea");
      field.rows = o.rows || 3;
    } else if (type === "select") {
      field = document.createElement("select");
      (o.options || []).forEach((opt) => {
        const option = document.createElement("option");
        const value = typeof opt === "object" ? opt.value : opt;
        option.value = String(value);
        option.textContent = typeof opt === "object" ? opt.label : String(opt);
        field.appendChild(option);
      });
    } else {
      field = document.createElement("input");
      field.type = type === "number" ? "text" : type;
      if (type === "number") field.inputMode = o.inputMode || "decimal";
      else if (o.inputMode) field.inputMode = o.inputMode;
      field.autocomplete = "off";
    }
    field.id = "crmPromptField";
    field.className = "crm-prompt__input";
    if (o.placeholder && type !== "select") field.placeholder = o.placeholder;
    if (o.value != null) field.value = String(o.value);
    return field;
  }

  function crmPrompt(opts) {
    const o = opts || {};
    ensureCss();
    const dlg = ensurePromptDom();
    const backdrop = document.getElementById("crmPromptBackdrop");
    const errorEl = document.getElementById("crmPromptError");
    const okBtn = document.getElementById("crmPromptOk");
    const cancelBtn = document.getElementById("crmPromptCancel");
    const labelEl = document.getElementById("crmPromptLabel");
    const textEl = document.getElementById("crmPromptText");
    const fieldWrap = document.getElementById("crmPromptFieldWrap");

    document.getElementById("crmPromptTitle").textContent = o.title || "";
    textEl.textContent = o.text || "";
    textEl.hidden = !o.text;
    labelEl.textContent = o.label || "";
    labelEl.hidden = !o.label;
    okBtn.textContent = o.ok || "Salvar";
    cancelBtn.textContent = o.cancel || "Cancelar";
    errorEl.hidden = true;
    fieldWrap.innerHTML = "";
    const field = buildField(o);
    if (!o.label) field.setAttribute("aria-label", o.title || "Valor");
    fieldWrap.appendChild(field);

    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const finish = (value) => {
        dlg.classList.remove("is-open");
        backdrop.classList.remove("is-open");
        dlg.hidden = true;
        backdrop.hidden = true;
        document.body.classList.remove("crm-confirm-open");
        dlg.removeEventListener("submit", onSubmit);
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
      const onSubmit = (e) => {
        e.preventDefault();
        const raw = String(field.value || "");
        const value = o.type === "textarea" ? raw : raw.trim();
        if (o.required && !value) {
          errorEl.textContent = o.requiredMessage || "Preencha este campo.";
          errorEl.hidden = false;
          field.focus();
          return;
        }
        if (o.type === "number" && value) {
          const n = Number(value.replace(",", "."));
          if (!Number.isFinite(n)) {
            errorEl.textContent = "Digite um número.";
            errorEl.hidden = false;
            field.focus();
            return;
          }
          finish(String(n));
          return;
        }
        finish(value);
      };
      const onCancel = () => finish(null);
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      };
      dlg.addEventListener("submit", onSubmit);
      cancelBtn.addEventListener("click", onCancel);
      backdrop.addEventListener("click", onCancel);
      document.addEventListener("keydown", onKey);

      dlg.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add("crm-confirm-open");
      requestAnimationFrame(() => {
        dlg.classList.add("is-open");
        backdrop.classList.add("is-open");
        field.focus();
        if (field.select && o.type !== "select") {
          try {
            field.select();
          } catch (_) {}
        }
      });
    });
  }

  async function crmShare(opts) {
    const o = typeof opts === "string" ? { url: opts } : opts || {};
    const url = o.url || "";
    if (!url) return;
    if (navigator.share) {
      try {
        await navigator.share({ url, title: o.title || undefined, text: o.text || undefined });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch (_) {}
    if (copied) {
      if (window.crmToast) window.crmToast.success(o.copiedMessage || "Link copiado");
      return;
    }
    // Last resort: show the link so it can be copied by hand.
    await crmPrompt({ title: o.title || "Link", value: url, ok: "Fechar", cancel: "Voltar" });
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
  window.crmPrompt = crmPrompt;
  window.crmShare = crmShare;
})();
