(function () {
  const form = document.getElementById("mateAiForm");
  const commandInput = document.getElementById("mateAiCommand");
  const previewButton = document.getElementById("mateAiPreviewButton");
  const previewSection = document.getElementById("mateAiPreview");
  const previewContent = document.getElementById("mateAiPreviewContent");
  const reviewTitle = document.getElementById("mateAiReviewTitle");
  const expiryLabel = document.getElementById("mateAiExpiry");
  const message = document.getElementById("mateAiMessage");
  const clarify = document.getElementById("mateAiClarify");
  const reviewed = document.getElementById("mateAiReviewed");
  const reviewedLabel = document.getElementById("mateAiReviewedLabel");
  const createButton = document.getElementById("mateAiCreateButton");
  const safeNote = document.getElementById("mateAiSafeNote");
  const successSection = document.getElementById("mateAiSuccess");
  const micButton = document.getElementById("mateAiMicButton");
  const micLabel = document.getElementById("mateAiMicLabel");
  const voiceStatus = document.getElementById("mateAiVoiceStatus");
  const voiceLanguage = document.getElementById("mateAiVoiceLanguage");

  /** Current preview: { action, token } */
  let current = null;
  /** Last plan returned by the server — picks edit it and re-run the preview without the AI. */
  let plan = null;
  let busy = false;

  /* ───────────── helpers ───────────── */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function setMessage(text, kind) {
    message.textContent = text || "";
    message.dataset.kind = kind || "error";
    message.hidden = !text;
    if (text) {
      // Re-trigger the highlight even when the same message comes back, so every click visibly responds.
      message.classList.remove("is-fresh");
      void message.offsetWidth;
      message.classList.add("is-fresh");
      const rect = message.getBoundingClientRect();
      if (rect.top < 60 || rect.bottom > window.innerHeight - 110) {
        message.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }

  function money(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(
      Number(value || 0),
    );
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(String(iso).slice(0, 10) + "T12:00:00");
    return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  }

  function addCell(row, text, heading) {
    const cell = el(heading ? "th" : "td", null, text == null ? "" : text);
    row.appendChild(cell);
    return cell;
  }

  function addTotal(container, label, value, grand) {
    const row = el("div", grand ? "mate-ai-total-row mate-ai-total-row--grand" : "mate-ai-total-row");
    row.append(el("span", null, label), el("strong", null, money(value)));
    container.appendChild(row);
  }

  function resetPreview() {
    current = null;
    previewSection.hidden = true;
    reviewed.checked = false;
    createButton.disabled = true;
  }

  function clearClarify() {
    clarify.replaceChildren();
    clarify.hidden = true;
  }

  async function postJson(path, payload) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      const error = new Error(data.error || "Não foi possível concluir a solicitação.");
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  /* ───────────── preview flow ───────────── */

  async function runPreview(payload) {
    if (busy) return;
    busy = true;
    resetPreview();
    clearClarify();
    successSection.hidden = true;
    setMessage(payload.plan ? "Atualizando…" : "Lendo o pedido…", "info");
    previewButton.disabled = true;
    previewButton.textContent = payload.plan ? "Atualizando…" : "Entendendo o pedido…";
    try {
      const data = await postJson("/api/mate-ai/preview", payload);
      plan = data.plan || plan;
      if (data.status === "ready") {
        if (data.action === "invoice") renderInvoicePreview(data);
        else renderQuotePreview(data);
        const via = data.interpreted_by === "ai" ? "Entendido pelo Mate AI. " : "Entendido. ";
        setMessage((data.warning ? data.warning + " " : "") + via + "Revise antes de confirmar.", "info");
      } else {
        renderClarification(data);
      }
    } catch (error) {
      setMessage(error.message || "Não foi possível gerar a prévia.", "error");
    } finally {
      busy = false;
      previewButton.disabled = false;
      previewButton.textContent = "Entender e revisar";
    }
  }

  function rerunWithPlan(nextPlan) {
    plan = nextPlan;
    runPreview({ plan: nextPlan });
  }

  function clonePlan() {
    return JSON.parse(JSON.stringify(plan));
  }

  /* ───────────── clarifications (tap to choose) ───────────── */

  function choiceGroup(title, options) {
    const group = el("div", "mate-ai-choice-group");
    if (title) group.appendChild(el("p", "mate-ai-choice-title", title));
    const list = el("div", "mate-ai-choices");
    options.forEach(function (option) {
      const button = el("button", "mate-ai-chip mate-ai-chip--choice");
      button.type = "button";
      button.appendChild(el("strong", null, option.label));
      if (option.detail) button.appendChild(el("span", null, option.detail));
      button.addEventListener("click", option.onPick);
      list.appendChild(button);
    });
    group.appendChild(list);
    return group;
  }

  function searchBox(placeholder, buttonLabel, onSubmit) {
    const wrap = el("form", "mate-ai-inline-search");
    const input = el("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.maxLength = 200;
    const button = el("button", "mate-ai-button mate-ai-button--secondary", buttonLabel);
    button.type = "submit";
    wrap.append(input, button);
    wrap.addEventListener("submit", function (event) {
      event.preventDefault();
      if (input.value.trim()) onSubmit(input.value.trim());
    });
    return wrap;
  }

  function catalogSelect(catalog, line) {
    const wrap = el("label", "mate-ai-catalog-select");
    wrap.appendChild(el("span", null, "Outro serviço do catálogo:"));
    const select = el("select");
    select.appendChild(new Option("Escolher…", ""));
    (catalog || []).forEach(function (item) {
      select.appendChild(new Option(item.name + " (" + item.unit + ")", item.source + "|" + item.id));
    });
    select.addEventListener("change", function () {
      if (!select.value) return;
      const parts = select.value.split("|");
      pickService(line, { source: parts[0], id: parts[1] });
    });
    wrap.appendChild(select);
    return wrap;
  }

  function pickService(line, option) {
    const next = clonePlan();
    const item = next.items[line - 1];
    if (!item) return;
    item.catalog_item_id = option.id;
    item.catalog_source = option.source;
    item.unit = null; // use the catalog unit
    rerunWithPlan(next);
  }

  function renderClarification(data) {
    clearClarify();
    const parts = [];
    if (data.message) parts.push(data.message);
    setMessage(parts.join(" ") || "Preciso de mais uma informação.", "info");

    if (data.action === "quote" && /^customer_/.test(data.status)) {
      const candidates = data.candidates || [];
      if (candidates.length) {
        clarify.appendChild(
          choiceGroup(
            "Cliente",
            candidates.map(function (customer) {
              return {
                label: customer.name,
                detail: customer.company || "",
                onPick: function () {
                  const next = clonePlan();
                  next.customer_id = customer.id;
                  rerunWithPlan(next);
                },
              };
            }),
          ),
        );
      }
      clarify.appendChild(
        searchBox("Buscar outro cliente pelo nome", "Buscar", function (name) {
          const next = clonePlan();
          next.customer_id = null;
          next.customer_query = name;
          rerunWithPlan(next);
        }),
      );
    }

    if (data.action === "quote" && data.status === "needs_clarification") {
      (data.issues || []).forEach(function (issue) {
        const box = el("div", "mate-ai-issue");
        box.appendChild(el("p", "mate-ai-choice-title", (issue.line ? "Item " + issue.line + ": " : "") + issue.message));
        if (Array.isArray(issue.options) && issue.options.length) {
          box.appendChild(
            choiceGroup(
              "",
              issue.options.map(function (option) {
                return {
                  label: option.name,
                  detail: option.unit,
                  onPick: function () {
                    pickService(issue.line, option);
                  },
                };
              }),
            ),
          );
        }
        if (issue.line && data.catalog && data.catalog.length) box.appendChild(catalogSelect(data.catalog, issue.line));
        clarify.appendChild(box);
      });
      if (data.customer) setMessage("Cliente: " + data.customer.name + ". Falta confirmar alguns serviços.", "info");
    }

    if (data.action === "invoice" && /^job_/.test(data.status)) {
      const candidates = data.candidates || [];
      if (candidates.length) {
        clarify.appendChild(
          choiceGroup(
            "Job",
            candidates.map(function (job) {
              const ref = job.number != null ? "#" + job.number + " · " + job.title : job.title;
              const detail = [job.customer_name, job.address, job.billing && job.billing.billing_status_label]
                .filter(Boolean)
                .join(" · ");
              return {
                label: ref,
                detail: detail,
                onPick: function () {
                  const next = clonePlan();
                  next.job_id = job.id;
                  rerunWithPlan(next);
                },
              };
            }),
          ),
        );
      }
      clarify.appendChild(
        searchBox("Número do job, cliente ou endereço", "Buscar", function (text) {
          const next = clonePlan();
          next.job_id = null;
          next.job_query = text;
          next.customer_query = "";
          rerunWithPlan(next);
        }),
      );
    }

    if (data.action === "invoice" && data.status === "needs_clarification" && data.job) {
      // Show the job and the invoice settings so the user can fix type/amount/date right here.
      renderInvoicePreview(Object.assign({}, data, { invoice: null }));
    }

    clarify.hidden = !clarify.childElementCount;
  }

  /* ───────────── quote preview ───────────── */

  function renderQuotePreview(data) {
    previewContent.replaceChildren();
    reviewTitle.textContent = "Quote — confira cliente, serviços e preços";
    const customer = el("div", "mate-ai-customer");
    customer.append(
      el("strong", null, "Cliente"),
      el("span", null, data.customer.company ? data.customer.name + " · " + data.customer.company : data.customer.name),
    );
    const change = el("button", "mate-ai-link", "trocar");
    change.type = "button";
    change.addEventListener("click", function () {
      const next = clonePlan();
      next.customer_id = null;
      resetPreview();
      renderClarification({ action: "quote", status: "customer_not_found", plan: next, candidates: [], message: "Qual cliente?" });
      plan = next;
    });
    customer.appendChild(change);
    previewContent.appendChild(customer);

    const tableWrap = el("div", "mate-ai-table-wrap");
    const table = el("table", "mate-ai-table");
    const head = el("thead");
    const headerRow = el("tr");
    ["Serviço", "Quantidade", "Preço unitário", "Total"].forEach(function (value) {
      addCell(headerRow, value, true);
    });
    head.appendChild(headerRow);
    table.appendChild(head);
    const body = el("tbody");
    data.items.forEach(function (item) {
      const row = el("tr");
      const serviceCell = addCell(row, item.name, false);
      if (item.spoken && item.spoken.toLowerCase() !== item.name.toLowerCase()) {
        serviceCell.appendChild(el("div", "mate-ai-service-spoken", "Você disse: “" + item.spoken + "”"));
      }
      if (item.description) serviceCell.appendChild(el("div", "mate-ai-service-description", item.description));
      addCell(row, Number(item.quantity).toLocaleString("en-US") + " " + item.unit, false);
      addCell(row, money(item.unitPrice), false);
      addCell(row, money(item.amount), false);
      body.appendChild(row);
    });
    table.appendChild(body);
    tableWrap.appendChild(table);
    previewContent.appendChild(tableWrap);

    const totals = el("div", "mate-ai-totals");
    addTotal(totals, "Subtotal", data.subtotal, false);
    addTotal(totals, "Tax (" + Number(data.tax_rate || 0).toFixed(2) + "%)", data.tax_total, false);
    addTotal(totals, "Total", data.total, true);
    previewContent.appendChild(totals);

    reviewedLabel.textContent = "Revisei o cliente, as medidas e os preços.";
    createButton.textContent = "Criar Quote em rascunho";
    safeNote.textContent = "Este passo cria somente um rascunho. O Mate AI não envia o Quote ao cliente.";
    showReview({ action: "quote", token: data.preview_token });
  }

  /* ───────────── invoice preview ───────────── */

  const INVOICE_TYPES = [
    ["full", "Valor total"],
    ["final", "Saldo restante"],
    ["deposit", "Depósito / sinal (%)"],
    ["progress", "Parcial (valor)"],
    ["custom", "Valor específico"],
  ];

  function renderInvoicePreview(data) {
    previewContent.replaceChildren();
    reviewTitle.textContent = "Invoice — confira o job, o valor e o vencimento";
    const job = data.job;

    const jobBox = el("div", "mate-ai-customer");
    jobBox.append(
      el("strong", null, "Job"),
      el("span", null, (job.number != null ? "#" + job.number + " · " : "") + job.title),
    );
    previewContent.appendChild(jobBox);
    const meta = [job.customer_name, job.address].filter(Boolean).join(" · ");
    if (meta) previewContent.appendChild(el("p", "mate-ai-job-meta", meta));

    if (Array.isArray(data.lines) && data.lines.length) {
      const tableWrap = el("div", "mate-ai-table-wrap");
      const table = el("table", "mate-ai-table");
      const head = el("thead");
      const headerRow = el("tr");
      ["Serviço do job", "Quantidade", "Preço unitário", "Total"].forEach(function (value) {
        addCell(headerRow, value, true);
      });
      head.appendChild(headerRow);
      table.appendChild(head);
      const body = el("tbody");
      data.lines.forEach(function (line) {
        const row = el("tr");
        addCell(row, line.name);
        addCell(row, Number(line.quantity).toLocaleString("en-US"));
        addCell(row, money(line.unit_price));
        addCell(row, money(line.amount));
        body.appendChild(row);
      });
      table.appendChild(body);
      tableWrap.appendChild(table);
      previewContent.appendChild(tableWrap);
    }

    const billing = job.billing || {};
    const totals = el("div", "mate-ai-totals");
    addTotal(totals, "Total dos serviços", billing.services_total, false);
    addTotal(totals, "Já faturado", billing.invoiced_total, false);
    if (data.invoice) addTotal(totals, "Esta invoice (" + data.invoice.type_label + ")", data.invoice.amount, true);
    previewContent.appendChild(totals);

    // Editable settings — changing any of them re-runs the preview with the same job.
    const settings = el("div", "mate-ai-invoice-settings");
    const typeLabel = el("label", null);
    typeLabel.appendChild(el("span", null, "Tipo"));
    const typeSelect = el("select");
    INVOICE_TYPES.forEach(function (t) {
      typeSelect.appendChild(new Option(t[1], t[0]));
    });
    typeSelect.value = (data.plan && data.plan.invoice_type !== "auto" && data.plan.invoice_type) || (data.invoice && data.invoice.type) || "full";
    typeLabel.appendChild(typeSelect);

    const valueLabel = el("label", null);
    const valueTitle = el("span", null, "");
    const valueInput = el("input");
    valueInput.type = "number";
    valueInput.min = "0";
    valueInput.step = "0.01";
    valueLabel.append(valueTitle, valueInput);

    const dateLabel = el("label", null);
    dateLabel.appendChild(el("span", null, "Vencimento"));
    const dateInput = el("input");
    dateInput.type = "date";
    dateInput.value = (data.plan && data.plan.due_date) || "";
    dateLabel.appendChild(dateInput);

    function syncValueField() {
      const type = typeSelect.value;
      valueLabel.hidden = !(type === "deposit" || type === "progress" || type === "custom");
      if (type === "deposit") {
        valueTitle.textContent = "Percentual (%)";
        valueInput.max = "100";
        valueInput.value = (data.plan && data.plan.deposit_pct) || "";
      } else {
        valueTitle.textContent = "Valor ($)";
        valueInput.removeAttribute("max");
        valueInput.value = (data.plan && data.plan.custom_amount) || "";
      }
    }
    syncValueField();

    const apply = el("button", "mate-ai-button mate-ai-button--secondary", "Atualizar valores");
    apply.type = "button";
    apply.addEventListener("click", function () {
      const next = clonePlan();
      next.invoice_type = typeSelect.value;
      const value = Number(valueInput.value);
      next.deposit_pct = typeSelect.value === "deposit" && value > 0 ? value : null;
      next.custom_amount = (typeSelect.value === "progress" || typeSelect.value === "custom") && value > 0 ? value : null;
      next.due_date = dateInput.value || null;
      rerunWithPlan(next);
    });
    typeSelect.addEventListener("change", syncValueField);

    settings.append(typeLabel, valueLabel, dateLabel, apply);
    previewContent.appendChild(settings);

    if (data.invoice) {
      previewContent.appendChild(
        el(
          "p",
          "mate-ai-job-meta",
          data.invoice.due_date
            ? "Vencimento: " + formatDate(data.invoice.due_date)
            : "Sem data informada — o vencimento padrão será amanhã.",
        ),
      );
      reviewedLabel.textContent = "Revisei o job, o valor e o vencimento.";
      createButton.textContent = "Emitir invoice";
      safeNote.textContent =
        "A invoice é emitida e aparece em Invoices. O Mate AI não envia e-mail ao cliente — use “Enviar” na invoice quando quiser.";
      showReview({ action: "invoice", token: data.preview_token });
    } else {
      // Clarification mode: show settings but no confirm button.
      previewSection.hidden = false;
      expiryLabel.textContent = "";
      reviewed.closest(".mate-ai-review-confirm").hidden = true;
      safeNote.hidden = true;
    }
  }

  function showReview(next) {
    current = next;
    expiryLabel.textContent = "Prévia válida por 10 minutos";
    reviewed.closest(".mate-ai-review-confirm").hidden = false;
    safeNote.hidden = false;
    previewSection.hidden = false;
    reviewed.checked = false;
    createButton.disabled = true;
    previewSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ───────────── confirm ───────────── */

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const command = commandInput.value.trim();
    if (!command) return;
    plan = null;
    runPreview({ command: command });
  });

  reviewed.addEventListener("change", function () {
    createButton.disabled = !reviewed.checked || !current;
  });

  commandInput.addEventListener("input", function () {
    resetPreview();
    clearClarify();
  });

  document.querySelectorAll("[data-example]").forEach(function (button) {
    button.addEventListener("click", function () {
      commandInput.value = button.textContent.trim();
      commandInput.dispatchEvent(new Event("input", { bubbles: true }));
      commandInput.focus();
    });
  });

  createButton.addEventListener("click", async function () {
    if (!current || !reviewed.checked) return;
    const action = current.action;
    const label = createButton.textContent;
    createButton.disabled = true;
    createButton.textContent = action === "invoice" ? "Emitindo…" : "Criando rascunho…";
    setMessage("", "");
    try {
      const data = await postJson(action === "invoice" ? "/api/mate-ai/invoices" : "/api/mate-ai/quote-drafts", {
        preview_token: current.token,
        confirmed_review: true,
      });
      resetPreview();
      const title = document.getElementById("mateAiSuccessTitle");
      const detail = document.getElementById("mateAiSuccessDetail");
      const link = document.getElementById("mateAiOpenQuote");
      const eyebrow = document.getElementById("mateAiSuccessEyebrow");
      const note = document.getElementById("mateAiSuccessNote");
      if (action === "invoice") {
        eyebrow.textContent = "Invoice emitida";
        title.textContent = "Invoice " + (data.data.invoice_number || "") + " emitida";
        detail.textContent =
          money(data.data.amount) + (data.data.due_date ? " · vence " + formatDate(data.data.due_date) : "");
        link.textContent = "Abrir invoice";
        link.href = data.url || "invoices.html";
        note.textContent = "Nenhum e-mail foi enviado ao cliente. Use “Enviar” na invoice quando estiver pronto.";
        setMessage("Invoice emitida.", "success");
      } else {
        eyebrow.textContent = "Rascunho criado";
        title.textContent = "Quote " + data.data.quote_number + " criado";
        detail.textContent =
          data.data.customer_name + " · " + data.data.item_count + " serviço(s) · " + money(data.data.total);
        link.textContent = "Abrir e revisar Quote";
        link.href = "quote-builder.html?id=" + encodeURIComponent(data.data.id);
        note.textContent =
          "O rascunho não foi enviado. Revise-o no editor e use o fluxo normal de envio quando estiver pronto.";
        setMessage("Rascunho criado. Nenhuma mensagem foi enviada ao cliente.", "success");
      }
      successSection.hidden = false;
      commandInput.value = "";
    } catch (error) {
      setMessage(error.message || "Não foi possível concluir. Gere uma nova prévia.", "error");
      createButton.disabled = !reviewed.checked || !current;
    } finally {
      createButton.textContent = label;
    }
  });

  /* ───────────── voice ───────────── */

  // Preferred: record audio and transcribe on the server (better accuracy, knows your
  // service and customer names). Fallback: the browser's own speech recognition.
  const canRecord = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let serverVoice = canRecord;
  let recorder = null;
  let chunks = [];
  let stream = null;
  let recognition = null;
  let listening = false;
  let maxTimer = null;

  function setListening(on) {
    listening = on;
    micButton.classList.toggle("is-listening", on);
    micLabel.textContent = on ? "Parar e enviar" : "Gravar comando";
  }

  try {
    const savedLang = window.localStorage.getItem("mateAiVoiceLang");
    if (savedLang && voiceLanguage.querySelector('option[value="' + savedLang + '"]')) voiceLanguage.value = savedLang;
  } catch (_e) {}
  voiceLanguage.addEventListener("change", function () {
    try {
      window.localStorage.setItem("mateAiVoiceLang", voiceLanguage.value);
    } catch (_e) {}
  });

  function languageHint() {
    const value = voiceLanguage.value || "auto";
    return value === "auto" ? null : value.slice(0, 2);
  }

  /** Browser recognition needs a concrete language; "auto" would follow the computer (often English). */
  function browserLanguage() {
    const value = voiceLanguage.value;
    if (value && value !== "auto") return value;
    const page = (document.documentElement.lang || "").toLowerCase();
    return page.startsWith("en") ? "en-US" : page.startsWith("es") ? "es-US" : "pt-BR";
  }

  function useTranscript(text) {
    commandInput.value = text;
    commandInput.dispatchEvent(new Event("input", { bubbles: true }));
    voiceStatus.textContent = "Ouvi: “" + text + "”. Se algo saiu errado, corrija o texto e toque em “Entender e revisar”.";
    runPreview({ command: text });
  }

  function pickMimeType() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    for (let i = 0; i < types.length; i++) {
      if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return "";
  }

  async function startRecording() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_error) {
      voiceStatus.textContent = "O navegador bloqueou o microfone. Libere a permissão ou digite o comando.";
      return;
    }
    const mimeType = pickMimeType();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
    chunks = [];
    recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    recorder.onerror = function () {
      voiceStatus.textContent = "A gravação falhou. Tente de novo ou digite o comando.";
      setListening(false);
    };
    recorder.onstop = function () {
      stream.getTracks().forEach(function (track) {
        track.stop();
      });
      clearTimeout(maxTimer);
      setListening(false);
      const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || "audio/webm" });
      if (blob.size < 1000) {
        voiceStatus.textContent = "Não captei áudio. Tente de novo, falando perto do microfone.";
        return;
      }
      sendAudio(blob);
    };
    recorder.start();
    setListening(true);
    voiceStatus.textContent = "Gravando… fale o pedido e toque em “Parar e enviar”.";
    maxTimer = setTimeout(function () {
      if (recorder && recorder.state === "recording") recorder.stop();
    }, 60000);
  }

  function sendAudio(blob) {
    voiceStatus.textContent = "Transcrevendo…";
    micButton.disabled = true;
    const reader = new FileReader();
    reader.onloadend = async function () {
      try {
        const payload = { data_url: reader.result };
        const lang = languageHint();
        if (lang) payload.language = lang;
        const data = await postJson("/api/mate-ai/transcribe", payload);
        useTranscript(data.text);
      } catch (error) {
        if (error.data && error.data.fallback === "browser" && SpeechRecognition) {
          serverVoice = false;
          voiceStatus.textContent = "Transcrição do servidor indisponível — usando o reconhecimento do navegador. Fale de novo.";
          startBrowserRecognition();
        } else {
          voiceStatus.textContent = error.message || "Não foi possível transcrever. Tente de novo ou digite o comando.";
        }
      } finally {
        micButton.disabled = false;
      }
    };
    reader.readAsDataURL(blob);
  }

  let finalTranscript = "";
  let recognitionHadText = false;

  function startBrowserRecognition() {
    if (!recognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onstart = function () {
        setListening(true);
        finalTranscript = "";
        recognitionHadText = false;
        voiceStatus.textContent = "Ouvindo… fale o pedido inteiro e toque em “Parar e enviar”.";
      };
      recognition.onresult = function (event) {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0] && result[0].transcript ? result[0].transcript : "";
          if (result.isFinal) finalTranscript += (finalTranscript ? " " : "") + text.trim();
          else interim += text;
        }
        const live = (finalTranscript + " " + interim).replace(/\s+/g, " ").trim();
        if (live) {
          recognitionHadText = true;
          commandInput.value = live;
        }
      };
      recognition.onerror = function (event) {
        if (event.error === "no-speech") {
          voiceStatus.textContent = "Não ouvi nada. Fale mais perto do microfone e tente de novo.";
        } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          voiceStatus.textContent = "O navegador bloqueou o microfone. Libere a permissão ou digite o comando.";
        } else if (event.error !== "aborted") {
          voiceStatus.textContent = "Não foi possível transcrever a fala (" + event.error + "). Tente de novo ou digite o comando.";
        }
      };
      recognition.onend = function () {
        setListening(false);
        const text = commandInput.value.trim();
        if (recognitionHadText && text) useTranscript(text);
      };
    }
    recognition.lang = browserLanguage();
    try {
      recognition.start();
    } catch (_error) {
      voiceStatus.textContent = "O microfone já está ativo. Toque em “Parar e enviar”.";
    }
  }


  if (!canRecord && !SpeechRecognition) {
    micButton.disabled = true;
    voiceStatus.textContent = "Gravação de voz não disponível neste navegador. Você ainda pode digitar o comando.";
  }

  // Ask the server once whether it can transcribe; if not, go straight to the browser's recognition.
  fetch("/api/mate-ai/status", { credentials: "same-origin" })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (data) {
      const modeNote = document.getElementById("mateAiMode");
      if (data && data.ai === false && modeNote) {
        modeNote.textContent =
          "Modo básico: a IA ainda não está ativa nesta conta. Funciona melhor com frases diretas — cliente, serviço e quantidade.";
        modeNote.hidden = false;
      }
      if (data && data.server_voice === false) {
        serverVoice = false;
        if (!SpeechRecognition) {
          micButton.disabled = true;
          voiceStatus.textContent =
            "A transcrição de voz não está ativa para esta empresa e este navegador não reconhece fala. Digite o comando.";
        }
      }
    })
    .catch(function () {});

  micButton.addEventListener("click", function () {
    if (listening) {
      if (recorder && recorder.state === "recording") recorder.stop();
      else if (recognition) recognition.stop();
      return;
    }
    if (serverVoice && canRecord) startRecording();
    else if (SpeechRecognition) startBrowserRecognition();
  });
})();
