(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const toast = (message) => {
    const element = $("#toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(element._timer);
    element._timer = setTimeout(() => element.classList.remove("show"), 2400);
  };

  /* Navigation and reading progress */
  const nav = $("#nav");
  const progress = $("#progress");
  const navLinks = $$('.nav-links a[href^="#"]');
  addEventListener(
    "scroll",
    () => {
      const page = document.documentElement;
      if (progress) {
        progress.style.width = `${(page.scrollTop / (page.scrollHeight - page.clientHeight || 1)) * 100}%`;
      }
      nav?.classList.toggle("scrolled", page.scrollTop > 8);
      let current = "";
      $$('main section[id]').forEach((section) => {
        if (section.getBoundingClientRect().top < 140) current = section.id;
      });
      navLinks.forEach((link) => {
        link.classList.toggle("active", link.getAttribute("href") === `#${current}`);
      });
    },
    { passive: true },
  );

  const burger = $("#burger");
  burger?.addEventListener("click", () => {
    const open = $("#links")?.classList.toggle("open");
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    burger.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
  });
  $$("#links a").forEach((link) =>
    link.addEventListener("click", () => {
      $("#links")?.classList.remove("open");
      burger?.setAttribute("aria-expanded", "false");
      burger?.setAttribute("aria-label", "Abrir menu");
    }),
  );

  /* Reveal sections as they enter the viewport */
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.12 },
    );
    $$(".reveal").forEach((element) => {
      if (reduceMotion) element.classList.add("in");
      else observer.observe(element);
    });
  } else {
    $$(".reveal").forEach((element) => element.classList.add("in"));
  }

  /* Feature explorer tabs */
  const tabs = $$("[data-feature-tab]");
  const panels = $$("[data-feature-panel]");
  function selectFeature(tab, moveFocus = false) {
    const name = tab?.dataset.featureTab;
    if (!name) return;
    tabs.forEach((item) => {
      const selected = item === tab;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.featurePanel !== name;
    });
    if (moveFocus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectFeature(tab));
    tab.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      selectFeature(tabs[next], true);
    });
  });

  /* Quote preview: the displayed total follows the entered floor area */
  const areaInput = $("#quote-area");
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
  function updateQuote() {
    if (!areaInput) return;
    const area = Math.max(1, Number(areaInput.value) || 1);
    areaInput.value = String(area);
    $$('[data-quote-quantity]').forEach((cell) => {
      cell.textContent = `${new Intl.NumberFormat("pt-BR").format(area)} ft²`;
    });
    let total = 0;
    $$('[data-quote-line]').forEach((cell) => {
      const line = area * Number(cell.dataset.quoteLine || 0);
      total += line;
      cell.textContent = money.format(line);
    });
    const totalElement = $("#quote-total");
    if (totalElement) totalElement.textContent = money.format(total);
  }
  areaInput?.addEventListener("input", updateQuote);
  $("[data-demo-action='save-draft']")?.addEventListener("click", () => {
    const status = $("[data-quote-status]");
    if (status) {
      status.textContent = "Rascunho salvo";
      status.className = "status status-draft";
    }
    toast("Rascunho do orçamento salvo nesta prévia.");
  });
  $("[data-demo-action='send-quote']")?.addEventListener("click", () => {
    const status = $("[data-quote-status]");
    if (status) {
      status.textContent = "Enviado";
      status.className = "status status-sent";
    }
    toast("Orçamento enviado ao cliente nesta prévia.");
  });

  /* Lead follow-up and creation preview */
  $("[data-demo-action='follow-up']")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    button.textContent = "Retorno marcado";
    button.disabled = true;
    button.setAttribute("aria-label", "Retorno marcado para Amanda Silva");
    toast("Retorno de Amanda marcado para hoje.");
  });
  $("[data-demo-action='new-lead']")?.addEventListener("click", () => {
    const list = $("#panel-leads .product-window");
    if (!list || $("[data-demo-new-lead]", list)) {
      toast("O novo lead de demonstração já está na lista.");
      return;
    }
    const row = document.createElement("div");
    row.className = "lead-row demo-new-lead";
    row.dataset.demoNewLead = "true";
    row.innerHTML = '<div><strong>Novo contato</strong><small>Adicionado agora</small></div><span>Projeto de flooring</span><span class="status status-new">Novo lead</span><span class="row-muted">Próxima ação pendente</span>';
    list.append(row);
    toast("Novo lead adicionado à prévia.");
  });

  /* Job checklist and visible completion state */
  const jobSteps = $$("[data-job-step]");
  function updateJobProgress() {
    const complete = jobSteps.filter((step) => step.checked).length;
    const progressbar = $("[data-job-progress]");
    const label = $("[data-job-progress-label]");
    if (progressbar) {
      progressbar.setAttribute("aria-valuenow", String(complete));
      const fill = $("span", progressbar);
      if (fill) fill.style.width = `${(complete / Math.max(jobSteps.length, 1)) * 100}%`;
    }
    if (label) label.textContent = `${complete} de ${jobSteps.length} etapas`;
    jobSteps.forEach((step) => {
      const note = $("small", step.parentElement);
      if (note) note.textContent = step.checked ? "Concluída · agora" : "Marque quando finalizar";
    });
  }
  jobSteps.forEach((step) => step.addEventListener("change", updateJobProgress));

  /* Invoice and team assignment previews */
  $("[data-demo-action='record-payment']")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    const status = $("[data-invoice-status]");
    if (status) {
      status.textContent = "Recebida";
      status.className = "status status-paid";
    }
    button.textContent = "Recebimento registrado";
    button.disabled = true;
    toast("Recebimento registrado nesta prévia.");
  });
  $("[data-demo-action='assign-team']")?.addEventListener("click", () => {
    const assignee = $("#team-assignee")?.value;
    const assigned = $("[data-assigned-person]");
    if (assignee && assigned) assigned.textContent = assignee;
    toast(assignee ? `Obra Rivera atribuída a ${assignee}.` : "Escolha uma equipe.");
  });

  /* Pricing toggle */
  const billingButtons = $$(".bill-toggle button");
  function setBilling(mode) {
    billingButtons.forEach((button) => {
      const selected = button.dataset.bill === mode;
      button.classList.toggle("is-on", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $$(".price-card .amt").forEach((element) => {
      const value = element.getAttribute(mode === "year" ? "data-year" : "data-month") || "";
      const amount = $("b", element);
      if (amount) amount.textContent = value;
    });
  }
  billingButtons.forEach((button) => {
    button.addEventListener("click", () => setBilling(button.dataset.bill || "month"));
  });

  $("#videoPlay")?.addEventListener("click", () => {
    toast("Em breve: vídeo de demonstração do ObraMate.");
  });
})();
