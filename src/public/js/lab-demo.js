(() => {
  const cols = [...document.querySelectorAll(".demo-col")];
  const side = document.getElementById("side");
  const shell = document.querySelector(".demo-shell");
  const prompt = document.getElementById("prompt");
  const trialBtn = document.getElementById("trialBtn");
  const pool = [
    ["Rivera Residence", "LVP", 4280],
    ["Chen Condo", "Hardwood", 5610],
    ["Oak St Duplex", "Laminate", 3380],
    ["Patel Kitchen", "Tile", 2940],
  ];
  let pi = 0;
  let wonValue = 0;
  let dragged = null;

  function money(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function counts() {
    cols.forEach((c) => {
      const em = c.querySelector("em");
      if (em) em.textContent = String(c.querySelectorAll(".demo-card").length);
    });
  }
  function mk(stage) {
    const [name, type, v] = pool[pi++ % pool.length];
    const card = document.createElement("div");
    card.className = "demo-card";
    card.draggable = true;
    card.dataset.v = String(v);
    card.dataset.name = name;
    card.innerHTML = `<b>${name}</b><small>${type} · ${money(v)}</small>`;
    bind(card);
    cols[stage].appendChild(card);
    counts();
    return card;
  }
  function bind(card) {
    card.addEventListener("dragstart", () => {
      dragged = card;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      dragged = null;
    });
    card.addEventListener("click", () => {
      const s = +card.parentElement.dataset.stage;
      if (s < 3) move(card, s + 1);
    });
  }
  function move(card, stage) {
    const from = +card.parentElement.dataset.stage;
    if (from === stage) return;
    cols[stage].appendChild(card);
    counts();
    if (stage === 3 && from !== 3) {
      wonValue = +card.dataset.v;
      openFaturar(card.dataset.name, wonValue);
    }
  }
  function openFaturar(name, total) {
    side.hidden = false;
    shell.classList.add("has-side");
    document.getElementById("sideSub").textContent = `${name} — choose how much to invoice now.`;
    document.getElementById("depAmt").textContent = money(total * 0.5);
    document.getElementById("fullAmt").textContent = money(total);
    document.getElementById("customAmt").value = Math.round(total * 0.3);
    document.getElementById("customAmt").max = total;
    document.getElementById("done").hidden = true;
    prompt.innerHTML = `Nice — now pick <b>Depósito</b>, <b>Outro</b>, or <b>Total</b>.`;
  }

  cols.forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("over");
    });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("over");
      if (dragged) move(dragged, +col.dataset.stage);
    });
  });

  document.getElementById("createInv")?.addEventListener("click", () => {
    const kind = document.querySelector('input[name="kind"]:checked')?.value || "deposit";
    let amt = wonValue;
    if (kind === "deposit") amt = wonValue * 0.5;
    if (kind === "custom") amt = Math.min(wonValue, Math.max(1, +document.getElementById("customAmt").value || 0));
    const done = document.getElementById("done");
    done.hidden = false;
    done.textContent = `Invoice created · ${money(amt)} (${kind}). In the real app, services list + Total Services appear here.`;
    prompt.innerHTML = `You just ran the job flow. <b>Start free</b> to do it with your company.`;
    trialBtn.hidden = false;
  });

  document.querySelectorAll(".demo-opt input[type=number]").forEach((inp) => {
    inp.addEventListener("focus", () => {
      inp.closest(".demo-opt")?.querySelector('input[type=radio]')?.click();
    });
  });

  mk(0);
  mk(0);
  mk(1);
  mk(2);
  counts();
})();
