(function () {
  const form = document.getElementById("mateAiForm");
  const commandInput = document.getElementById("mateAiCommand");
  const previewButton = document.getElementById("mateAiPreviewButton");
  const previewSection = document.getElementById("mateAiPreview");
  const previewContent = document.getElementById("mateAiPreviewContent");
  const expiryLabel = document.getElementById("mateAiExpiry");
  const message = document.getElementById("mateAiMessage");
  const reviewed = document.getElementById("mateAiReviewed");
  const createButton = document.getElementById("mateAiCreateButton");
  const successSection = document.getElementById("mateAiSuccess");
  const micButton = document.getElementById("mateAiMicButton");
  const micLabel = document.getElementById("mateAiMicLabel");
  const voiceStatus = document.getElementById("mateAiVoiceStatus");
  const voiceLanguage = document.getElementById("mateAiVoiceLanguage");

  let previewToken = "";
  let recognition = null;
  let listening = false;

  function setMessage(text, kind) {
    message.textContent = text || "";
    message.dataset.kind = kind || "error";
    message.hidden = !text;
  }

  function money(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function addCell(row, text, heading) {
    const cell = document.createElement(heading ? "th" : "td");
    cell.textContent = String(text == null ? "" : text);
    row.appendChild(cell);
    return cell;
  }

  function addTotal(container, label, value, grand) {
    const row = document.createElement("div");
    row.className = grand ? "mate-ai-total-row mate-ai-total-row--grand" : "mate-ai-total-row";
    const title = document.createElement("span");
    title.textContent = label;
    const amount = document.createElement("strong");
    amount.textContent = money(value);
    row.append(title, amount);
    container.appendChild(row);
  }

  function showIssues(data) {
    previewToken = "";
    previewSection.hidden = true;
    const parts = [];
    if (data.message) parts.push(data.message);
    if (Array.isArray(data.candidates) && data.candidates.length) {
      parts.push("Clientes encontrados: " + data.candidates.map((customer) => customer.name).join(", ") + ".");
    }
    if (Array.isArray(data.issues)) {
      data.issues.forEach((issue) => {
        let line = "Item " + issue.line + ": " + issue.message;
        if (Array.isArray(issue.suggestions) && issue.suggestions.length) {
          line += " Opções: " + issue.suggestions.join(", ") + ".";
        }
        parts.push(line);
      });
    }
    setMessage(parts.join(" "), "error");
  }

  function renderPreview(data) {
    previewContent.replaceChildren();
    const customer = document.createElement("div");
    customer.className = "mate-ai-customer";
    const label = document.createElement("strong");
    label.textContent = "Cliente";
    const name = document.createElement("span");
    name.textContent = data.customer.company
      ? data.customer.name + " · " + data.customer.company
      : data.customer.name;
    customer.append(label, name);
    previewContent.appendChild(customer);

    const tableWrap = document.createElement("div");
    tableWrap.className = "mate-ai-table-wrap";
    const table = document.createElement("table");
    table.className = "mate-ai-table";
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Serviço", "Quantidade", "Preço unitário", "Total"].forEach((value) => addCell(headerRow, value, true));
    head.appendChild(headerRow);
    table.appendChild(head);
    const body = document.createElement("tbody");
    data.items.forEach((item) => {
      const row = document.createElement("tr");
      const serviceCell = addCell(row, item.name, false);
      if (item.description) {
        const detail = document.createElement("div");
        detail.className = "mate-ai-service-description";
        detail.textContent = item.description;
        serviceCell.appendChild(detail);
      }
      addCell(row, Number(item.quantity).toLocaleString("en-US") + " " + item.unit, false);
      addCell(row, money(item.unitPrice), false);
      addCell(row, money(item.amount), false);
      body.appendChild(row);
    });
    table.appendChild(body);
    tableWrap.appendChild(table);
    previewContent.appendChild(tableWrap);

    const totals = document.createElement("div");
    totals.className = "mate-ai-totals";
    addTotal(totals, "Subtotal", data.subtotal, false);
    addTotal(totals, "Tax (" + Number(data.tax_rate || 0).toFixed(2) + "%)", data.tax_total, false);
    addTotal(totals, "Total", data.total, true);
    previewContent.appendChild(totals);
    expiryLabel.textContent = "Prévia válida por 10 minutos";
    previewSection.hidden = false;
    reviewed.checked = false;
    createButton.disabled = true;
    previewToken = data.preview_token;
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
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir a solicitação.");
    return data;
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    previewToken = "";
    previewSection.hidden = true;
    successSection.hidden = true;
    setMessage("", "");
    previewButton.disabled = true;
    previewButton.textContent = "Buscando cliente e preços…";
    try {
      const data = await postJson("/api/mate-ai/preview", { command: commandInput.value });
      if (data.status !== "ready") {
        showIssues(data);
        return;
      }
      renderPreview(data);
      setMessage("Cliente e serviços encontrados na empresa atual. Revise os valores antes de criar o rascunho.", "info");
    } catch (error) {
      setMessage(error.message || "Não foi possível gerar a prévia.", "error");
    } finally {
      previewButton.disabled = false;
      previewButton.textContent = "Buscar e revisar";
    }
  });

  reviewed.addEventListener("change", function () {
    createButton.disabled = !reviewed.checked || !previewToken;
  });

  commandInput.addEventListener("input", function () {
    previewToken = "";
    previewSection.hidden = true;
    createButton.disabled = true;
  });

  createButton.addEventListener("click", async function () {
    if (!previewToken || !reviewed.checked) return;
    createButton.disabled = true;
    createButton.textContent = "Criando rascunho…";
    setMessage("", "");
    try {
      const data = await postJson("/api/mate-ai/quote-drafts", {
        preview_token: previewToken,
        confirmed_review: true,
      });
      previewToken = "";
      previewSection.hidden = true;
      document.getElementById("mateAiSuccessTitle").textContent = "Quote " + data.data.quote_number + " criado";
      document.getElementById("mateAiSuccessDetail").textContent =
        data.data.customer_name + " · " + data.data.item_count + " serviço(s) · " + money(data.data.total);
      document.getElementById("mateAiOpenQuote").href =
        "quote-builder.html?id=" + encodeURIComponent(data.data.id);
      successSection.hidden = false;
      setMessage("Rascunho criado. Nenhuma mensagem foi enviada ao cliente.", "success");
    } catch (error) {
      setMessage(error.message || "Não foi possível criar o rascunho. Gere uma nova prévia.", "error");
      createButton.disabled = !reviewed.checked || !previewToken;
    } finally {
      createButton.textContent = "Criar Quote em rascunho";
    }
  });

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micButton.disabled = true;
    voiceStatus.textContent = "O reconhecimento de voz não está disponível neste navegador. Você ainda pode digitar ou colar o comando.";
  } else {
    recognition = new SpeechRecognition();
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = function () {
      listening = true;
      micButton.classList.add("is-listening");
      micLabel.textContent = "Ouvindo…";
      voiceStatus.textContent = "Fale o comando. Revise a transcrição antes de continuar.";
    };
    recognition.onresult = function (event) {
      const transcript = Array.from(event.results || [])
        .map(function (result) {
          return result[0] && result[0].transcript ? result[0].transcript : "";
        })
        .join(" ")
        .trim();
      if (transcript) {
        commandInput.value = transcript;
        commandInput.dispatchEvent(new Event("input", { bubbles: true }));
        voiceStatus.textContent = "Transcrição preenchida. Revise e corrija o texto antes de buscar.";
      }
    };
    recognition.onerror = function (event) {
      voiceStatus.textContent = event.error === "not-allowed"
        ? "O navegador bloqueou o microfone. Libere a permissão ou digite o comando."
        : "Não foi possível transcrever a fala. Tente novamente ou digite o comando.";
    };
    recognition.onend = function () {
      listening = false;
      micButton.classList.remove("is-listening");
      micLabel.textContent = "Falar comando";
    };
    micButton.addEventListener("click", function () {
      if (listening) {
        recognition.stop();
        return;
      }
      recognition.lang = voiceLanguage.value;
      try {
        recognition.start();
      } catch (_error) {
        voiceStatus.textContent = "O microfone já está ativo. Aguarde a transcrição terminar.";
      }
    });
  }
})();
