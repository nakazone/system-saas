/**
 * Jobs — leitura derivada de um job (atraso, etapa, cobrança). Usado pela lista,
 * pela página do job e pelo celular para falar a mesma língua.
 * window.JobsInfo = { late, step, progHtml, stageLabel, crewStageLabel, bill, money, money0, client, dateRange, esc }
 */
(function () {
  const DAY = 86400000;
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  const fmt0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const fmt2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const money0 = (n) => fmt0.format(Number(n) || 0);
  const money = (n) => fmt2.format(Number(n) || 0);

  /** Label with optional client code: "Name - ID" (does not mutate Customer.name). */
  function displayName(name, clientCode) {
    const n = String(name || "").trim();
    const code = String(clientCode || "").trim();
    if (!code) return n;
    if (!n) return code;
    return `${n} - ${code}`;
  }

  /** Real client/homeowner name — no nickname, no Client ID (Campo / Obra Crew). */
  function fieldClient(wo) {
    const homeowner = String(wo.homeowner_name || wo.homeownerName || "").trim();
    const lead = String(wo.lead_name || "").trim();
    const customer = String(
      (wo.customer && (wo.customer.name || wo.customer.company)) || wo.customer_name || "",
    ).trim();
    const builder = String(
      wo.builder?.company ||
        wo.builder?.name ||
        [wo.builder?.firstName, wo.builder?.lastName].filter(Boolean).join(" ") ||
        "",
    ).trim();
    const base = String(
      homeowner || customer || builder || lead || wo.source_name || wo.client || "",
    ).trim();
    return base || "Sem cliente";
  }

  /** Admin label: nickname when set, plus optional client code ("Name - ID"). */
  function client(wo) {
    const lead = String(wo.lead_name || "").trim();
    const ref = String(wo.client_ref || "").trim();
    const nick = String(wo.builder?.nickname || wo.customer?.nickname || "").trim();
    const base = String(
      nick ||
        (wo.customer && (wo.customer.name || wo.customer.company)) ||
        wo.builder?.company ||
        wo.builder?.name ||
        lead ||
        wo.source_name ||
        "",
    ).trim();
    if (ref) {
      if (!base) return ref;
      if (base.toLowerCase().includes(ref.toLowerCase())) return base;
      return `${base} - ${ref}`;
    }
    return base || "Sem cliente";
  }

  function builderName(wo) {
    return String(
      wo.builder?.nickname || wo.builder?.company || wo.builder?.name || wo.source_name || "",
    ).trim();
  }

  /** One line that identifies the job: builder, quote number, job number, address. */
  function findLine(wo) {
    const who = client(wo);
    const builder = builderName(wo);
    const bits = [];
    if (builder && builder.toLowerCase() !== String(who).toLowerCase()) bits.push(builder);
    if (who) bits.push(who);
    if (wo.quote_number) bits.push(wo.quote_number);
    if (wo.number != null && wo.number !== "") bits.push(`#${wo.number}`);
    if (wo.address) bits.push(wo.address);
    return bits.filter(Boolean).join(" · ");
  }

  function searchText(wo) {
    return [
      wo.title,
      wo.number,
      wo.number != null ? `#${wo.number}` : "",
      wo.quote_number,
      wo.quote_title,
      wo.lead_name,
      wo.client_ref,
      wo.address,
      wo.source_name,
      wo.notes,
      client(wo),
      builderName(wo),
      wo.builder?.name,
      wo.customer?.name,
      wo.customer?.company,
      wo.customer?.display_name,
      wo.assigned_user?.name,
    ]
      .filter((v) => v != null && String(v).trim())
      .join(" ")
      .toLowerCase();
  }

  function isActive(wo) {
    return wo.status === "draft" || wo.status === "scheduled" || wo.status === "in_progress";
  }

  /**
   * { days, label, kind } when a job still needs Start and the scheduled day has passed.
   * Once the crew has given Start (in_progress), the job is in production until they
   * finish — past calendar dates do not mark it late (there is no separate end-day gate).
   */
  function late(wo, now) {
    if (!isActive(wo) || wo.status === "in_progress") return null;
    const sand = awaitingSand(wo) || listOnSandDay(wo);
    const anchor = sand ? wo.sand_scheduled_start || listAnchorIso(wo) : listAnchorIso(wo) || wo.scheduled_start;
    if (!anchor) return null;
    const t = now || Date.now();
    const start = new Date(anchor).getTime();
    // Sand phase uses the sand date only — never the installation scheduled_end.
    const end = new Date(sand ? anchor : wo.scheduled_end || anchor).getTime();
    if (start >= t - DAY / 2 && end >= t) return null;
    if (end < t) {
      const d = Math.max(1, Math.floor((t - end) / DAY));
      return { days: d, kind: "notstarted", label: `não iniciado · ${d} dia${d > 1 ? "s" : ""}`, short: `Não iniciado · ${d} dia${d > 1 ? "s" : ""}` };
    }
    return null;
  }

  /**
   * Etapa atual 0..5 no caminho Agendado → Em campo → Concluído → Faturado → Pago.
   * 5 = tudo feito (pago). -1 = cancelado.
   */
  function step(wo) {
    if (wo.status === "canceled") return -1;
    if (wo.status === "in_progress") return 1;
    if (wo.status !== "completed") return 0;
    const b = wo.billing;
    if (!b || b.billing_status === "no_value") return 5;
    if (b.billing_status === "paid") return 5;
    if (b.remaining_to_invoice > 0.004) return 3;
    if (b.open_balance > 0.004) return 4;
    return 5;
  }
  const STEP_NAMES = ["Agendado", "Em campo", "Concluído", "Faturado", "Pago"];
  /** Status do job ao clicar nas 3 primeiras barras. Índices 3–4 são cobrança. */
  const STATUS_BY_STEP = ["scheduled", "in_progress", "completed"];
  const STATUS_STEP_MSG = {
    scheduled: "Job movido para Agendado.",
    in_progress: "Job iniciado.",
    completed: "Job concluído.",
  };

  function statusForStep(i) {
    return STATUS_BY_STEP[i] || null;
  }

  /** Já está no status alvo da barra (sem chamar a API de novo). */
  function atStatus(wo, status) {
    if (!wo || !status) return true;
    return wo.status === status;
  }

  /** Installation + Lixa on the same job. A completed job counts both sectors as done. */
  function sectorProgress(wo) {
    const both = Boolean(wo && wo.sector === "both");
    const closed = Boolean(wo && (wo.status === "completed" || wo.status === "canceled"));
    return {
      both,
      installation: !both || closed || Boolean(wo.installation_done_at),
      sand: !both || closed || Boolean(wo.sand_done_at),
    };
  }

  /** Next sector to close, or null when the job is not waiting on a second finish. */
  function nextFinish(wo) {
    const p = sectorProgress(wo);
    if (!p.both || !wo || wo.status === "completed" || wo.status === "canceled") return null;
    if (!p.installation) {
      return {
        sector: "installation",
        label: "Concluir instalação",
        confirm: "Concluir a instalação? A lixa continua em aberto.",
        toast: "Instalação concluída. Falta a lixa.",
      };
    }
    if (!p.sand) {
      return {
        sector: "sand",
        label: "Concluir lixa",
        confirm: "Concluir a lixa e fechar o job?",
        toast: "Lixa concluída.",
      };
    }
    return null;
  }

  function fieldHalves(wo) {
    const p = sectorProgress(wo);
    if (!p.both) return null;
    const active = wo.status === "in_progress";
    const inst = p.installation ? "d" : active ? "n" : "";
    const sand = p.sand ? "d" : p.installation && active ? "n" : "";
    return { inst, sand };
  }

  /**
   * In-progress label from the job's service: Installation → Installing, Sand & Finish → Sanding.
   * On a both-sector job, switch to Sanding once installation is done (awaiting sand).
   */
  function fieldPhaseLabel(wo) {
    const sector = String(wo?.sector || "").toLowerCase();
    if (awaitingSand(wo) || sector === "sand_finish") return "Sanding";
    if (sector === "both") {
      const p = sectorProgress(wo);
      if (p.installation && !p.sand) return "Sanding";
    }
    return "Installing";
  }

  /** True for any in-field stage chip (new + legacy labels). */
  function isInFieldStage(label) {
    const s = String(label || "");
    return s === "Installing" || s === "Sanding" || s === "Em campo" || s === "Lixa";
  }

  function stageLabel(wo) {
    if (wo.status === "canceled") return "Cancelado";
    if (wo.status === "draft" && !wo.scheduled_start) return "Rascunho";
    if (!wo.scheduled_start && wo.status !== "completed") return "Sem data";
    const s = step(wo);
    if (s === 0) return "Agendado";
    if (s === 1) return fieldPhaseLabel(wo);
    if (s === 3) return "Concluído";
    if (s === 4) return "Faturado";
    return wo.billing && wo.billing.billing_status === "paid" ? "Pago" : "Concluído";
  }

  /**
   * ObraCrew / Campo: production chronology only (Scheduled → In the Field → Completed).
   * Never Faturado / Pago — billing does not change this label.
   */
  function crewStageLabel(wo) {
    if (!wo) return "Agendado";
    if (wo.status === "canceled") return "Cancelado";
    if (wo.status === "completed") return "Concluído";
    if (wo.status === "in_progress") {
      let stage = fieldPhaseLabel(wo);
      if (wo.sector === "both" && listOnSandDay(wo) && stage === "Installing") stage = "Sanding";
      return stage;
    }
    return "Agendado";
  }

  function crewStageTone(wo) {
    if (!wo) return "wait";
    if (wo.status === "canceled") return "off";
    if (wo.status === "completed") return "ok";
    if (wo.status === "in_progress") return "act";
    return "wait";
  }

  function crewListWhen(wo) {
    const base = listWhen(wo);
    return { date: base.date, status: crewStageLabel(wo) };
  }

  function progHtml(wo) {
    const s = step(wo);
    if (s < 0) return `<span class="jx-prog jx-prog--x"></span>`;
    const halves = fieldHalves(wo);
    let h = "";
    for (let i = 0; i < 5; i += 1) {
      if (i === 1 && halves) {
        const inst = s > 1 ? "d" : halves.inst;
        const sand = s > 1 ? "d" : halves.sand;
        h += `<i class="jx-prog__split"><b class="${inst}"></b><b class="${sand}"></b></i>`;
      } else {
        const c = i < s ? "d" : i === s ? "n" : "";
        h += `<i class="${c}"></i>`;
      }
    }
    return `<span class="jx-prog" aria-label="Etapa: ${esc(stageLabel(wo))}">${h}</span>`;
  }

  /** Rótulo curto de cobrança. cls: '' | 'dk' | 'ok' | 'mu' */
  function bill(wo) {
    const b = wo.billing;
    if (!b) return null;
    if (b.billing_status === "no_value") return { text: "Sem valor", cls: "mu" };
    if (b.billing_status === "paid") return { text: "Pago", cls: "ok" };
    if (b.open_balance > 0.004 && b.remaining_to_invoice <= 0.004) return { text: `${money0(b.open_balance)} a receber`, cls: "dk" };
    if (b.open_balance > 0.004) return { text: `${money0(b.open_balance)} a receber`, cls: "dk" };
    if (b.billing_status === "partially_invoiced") return { text: `Falta faturar ${money0(b.remaining_to_invoice)}`, cls: "" };
    return { text: "A faturar", cls: "" };
  }

  function dayLabel(iso) {
    if (!iso) return "";
    const s = new Date(iso);
    if (Number.isNaN(s.getTime())) return "";
    return `${WD[s.getDay()]} ${s.getDate()} ${MO[s.getMonth()]}`;
  }
  function dateRange(wo) {
    const main = dayLabel(wo.scheduled_start);
    const sand = wo.sector === "both" ? dayLabel(wo.sand_scheduled_start) : "";
    if (wo.sector === "both") {
      if (!main && !sand) return "Sem data";
      return `Installation ${main || "sem data"} · Sand & Finish ${sand || "sem data"}`;
    }
    if (!wo.scheduled_start) return "Sem data";
    return main;
  }

  /** Installation is done and the job is waiting on the sand date. */
  function awaitingSand(wo) {
    if (!wo || wo.sector !== "both" || wo.status === "canceled") return false;
    if (wo.sand_done_at) return false;
    return Boolean(wo.installation_done_at);
  }

  /**
   * Date that places the job on the list.
   * Prefer the sand day when that is today, when install is done, or when install day is already past.
   */
  function listAnchorIso(wo) {
    if (!wo) return null;
    if (awaitingSand(wo) && wo.sand_scheduled_start) return wo.sand_scheduled_start;
    if (wo.sand_scheduled_start && isToday(wo.sand_scheduled_start)) return wo.sand_scheduled_start;
    if (wo.sector === "both" && wo.sand_scheduled_start && wo.scheduled_start) {
      const inst = new Date(wo.scheduled_start);
      const now = new Date();
      const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (!Number.isNaN(inst.getTime()) && inst < today0) return wo.sand_scheduled_start;
    }
    if (wo.sector === "sand_finish") return wo.scheduled_start || wo.sand_scheduled_start || null;
    return wo.scheduled_start || (wo.sector === "both" ? wo.sand_scheduled_start : null) || wo.sand_scheduled_start || null;
  }

  /** True when the list is showing the sand calendar day for this job. */
  function listOnSandDay(wo) {
    const anchor = listAnchorIso(wo);
    return Boolean(anchor && wo.sand_scheduled_start && String(anchor) === String(wo.sand_scheduled_start));
  }

  /**
   * List row: one date. Both-sector jobs show Installation vs Sanding from the anchored day.
   * A finished job never reads as "sem data" just because one sector date was left blank.
   */
  function listWhen(wo) {
    const anchor = listAnchorIso(wo);
    let date = anchor ? dayLabel(anchor) : "";
    const finished = wo.status === "completed" || wo.status === "canceled";
    if (!date && wo.status === "completed") date = dayShort(wo.updated_at || wo.scheduled_end) || "";
    if (!date && !finished) date = "Sem data";
    let stage = stageLabel(wo);
    if (!finished && wo.sector === "both" && listOnSandDay(wo) && (stage === "Agendado" || stage === "Installing")) {
      stage = wo.status === "in_progress" ? "Sanding" : "Agendado · Lixa";
    }
    const fallback = {
      draft: "Rascunho",
      scheduled: "Agendado",
      in_progress: fieldPhaseLabel(wo),
      completed: "Concluído",
      canceled: "Cancelado",
    };
    const status = stage && stage !== "Sem data" ? stage : fallback[wo.status] || "";
    return { date, status };
  }

  function startMs(wo) {
    const iso = listAnchorIso(wo);
    if (!iso) return null;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? null : t;
  }

  /** Upcoming dates first (closest first), then past dates, undated last. */
  function compareNearest(a, b, now) {
    const t = now || Date.now();
    const ta = startMs(a);
    const tb = startMs(b);
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    const cut = t - DAY / 2;
    const aUp = ta >= cut;
    const bUp = tb >= cut;
    if (aUp && bUp) return ta - tb;
    if (aUp) return -1;
    if (bUp) return 1;
    return tb - ta;
  }

  function completeLabel(wo) {
    if (!wo || wo.status !== "completed") return "Ainda não concluído";
    const day = dayShort(wo.updated_at || wo.scheduled_end || wo.scheduled_start);
    return day || "Concluído";
  }

  function dayShort(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getDate()} ${MO[d.getMonth()]}`;
  }

  function isToday(iso) {
    if (!iso) return false;
    return new Date(iso).toDateString() === new Date().toDateString();
  }

  function initials(name) {
    const p = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "—";
    return ((p[0][0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }

  function team(wo) {
    const out = [];
    if (wo.assigned_user?.name) out.push({ name: wo.assigned_user.name, lead: true });
    (wo.members || []).forEach((m) => {
      if (m.name && !out.some((o) => o.name === m.name)) out.push({ name: m.name });
    });
    (wo.temp_workers || []).forEach((t) => {
      if (t.name) out.push({ name: t.name, temp: true });
    });
    return out;
  }

  /**
   * ObraCam Jobs list. One chip for the work happening now, plus a check
   * when a service on a multi-service job is already finished.
   * Colors are the calendar colors (cal_install / cal_sand / cal_delivery).
   */
  function hasSandService(wo) {
    const s = String(wo?.sector || "");
    if (s === "sand_finish" || s === "both") return true;
    return Boolean(wo && wo.sand_scheduled_start);
  }
  function hasInstallService(wo) {
    return String(wo?.sector || "") !== "sand_finish";
  }
  function deliveryIsos(wo) {
    const out = [];
    if (wo && wo.delivery_scheduled_start) out.push(wo.delivery_scheduled_start);
    const list = Array.isArray(wo && wo.delivery_starts)
      ? wo.delivery_starts
      : Array.isArray(wo && wo.deliveries)
        ? wo.deliveries
        : [];
    list.forEach((row) => {
      const iso = typeof row === "string" ? row : row && row.scheduled_start;
      if (iso) out.push(iso);
    });
    return out;
  }
  function hasDeliveryService(wo) {
    return Boolean(wo && (wo.needs_delivery || deliveryIsos(wo).length));
  }
  function dayStamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function todayStamp() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  }
  function calColors(wo) {
    return {
      installation: (wo && wo.cal_install) || "#221e1a",
      sand: (wo && (wo.cal_sand || wo.cal_install)) || "#221e1a",
      delivery: (wo && wo.cal_delivery) || "#0f766e",
    };
  }
  function inField(wo) {
    const s = String((wo && wo.status) || "");
    const f = String((wo && wo.field_status) || "");
    return s === "in_progress" || s === "on_site" || s === "en_route" || f === "on_site" || f === "en_route";
  }
  function camListChips(wo) {
    if (!wo) return [];
    if (wo.status === "canceled") return [{ label: "Cancelado", tone: "off", mark: "none", color: null }];
    if (wo.status === "completed" || wo.status === "done") return [{ label: "Concluído", tone: "ok", mark: "check", color: null }];

    const colors = calColors(wo);
    const install = hasInstallService(wo);
    const sand = hasSandService(wo);
    const both = install && sand;
    const delivery = hasDeliveryService(wo);
    const starts = deliveryIsos(wo);
    const today = todayStamp();
    const stamps = starts.map(dayStamp).filter((n) => n != null);
    const deliveryToday = stamps.some((n) => n === today);
    const deliveryPast = stamps.length > 0 && stamps.every((n) => n < today);
    const installDone = Boolean(wo.installation_done_at);
    const sandOpen = sand && !wo.sand_done_at;
    const installOpen = install && !installDone;
    const chips = [];

    if (delivery && (install || sand) && deliveryPast) {
      chips.push({ label: "Delivery concluída", tone: "cal", mark: "check", color: colors.delivery });
    }
    if (both && installDone) {
      chips.push({ label: "Instalação concluída", tone: "cal", mark: "check", color: colors.installation });
    }

    let active = null;
    if (inField(wo)) {
      const sanding = sandOpen && (!install || installDone || listOnSandDay(wo));
      if (sanding) active = { label: "Lixando", tone: "cal", mark: "dot", color: colors.sand };
      else if (installOpen) active = { label: "Instalando", tone: "cal", mark: "dot", color: colors.installation };
      else if (delivery && !deliveryPast) active = { label: "Delivery", tone: "cal", mark: "dot", color: colors.delivery };
    } else if (deliveryToday) {
      active = { label: "Delivery", tone: "cal", mark: "dot", color: colors.delivery };
    } else {
      const lt = late(wo);
      const still = installOpen || sandOpen;
      if (lt && (still || !chips.length)) active = { label: lt.short, tone: "hot", mark: "dot", color: null };
      else if (!chips.length || still) {
        const color = !installOpen && sandOpen ? colors.sand : deliveryToday ? colors.delivery : listOnSandDay(wo) ? colors.sand : colors.installation;
        active = { label: "Agendado", tone: "cal", mark: "dot", color };
      }
    }

    if (deliveryToday && active && active.label !== "Delivery" && !chips.some((c) => c.label === "Delivery" || c.label === "Delivery concluída")) {
      chips.push({ label: "Delivery", tone: "cal", mark: "dot", color: colors.delivery });
    }
    if (active) chips.push(active);
    return chips;
  }

  /** Tom do selo na lista do CRM. hot = ação; act = em andamento; ok = fechado; off = cancelado. */
  function stageTone(wo) {
    if (!wo) return "wait";
    if (wo.status === "canceled") return "off";
    if (late(wo)) return "hot";
    const label = stageLabel(wo);
    if (label === "Sem data") return "hot";
    if (isInFieldStage(label)) return "act";
    if (label === "Concluído" || label === "Faturado" || label === "Pago") return "ok";
    return "wait";
  }

  window.JobsInfo = {
    esc, stageTone, crewStageTone, money, money0, client, fieldClient, builderName, findLine, searchText, displayName, isActive, late, step, STEP_NAMES, STATUS_BY_STEP, STATUS_STEP_MSG,
    statusForStep, atStatus, stageLabel, crewStageLabel, fieldPhaseLabel, isInFieldStage, camListChips, progHtml, sectorProgress, nextFinish, fieldHalves, bill, dateRange, listWhen, crewListWhen, listAnchorIso, listOnSandDay, awaitingSand, dayShort, completeLabel, compareNearest, startMs, isToday, initials, team,
  };
})();
