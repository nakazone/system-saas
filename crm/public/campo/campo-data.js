/**
 * Campo Phase 1 — mock data (Diego / Equipe A).
 * Replace with APIs in later phases.
 */
(function (global) {
  const VER = "20260925-campo1";

  const user = {
    id: "mock-diego",
    name: "Diego Santos",
    initials: "DS",
    team: "Equipe A",
    firstName: "Diego",
  };

  const jobs = [
    {
      id: "wo-1039",
      number: "1039",
      title: "Instalação dia 3 · apoio",
      client: "Fernanda Rocha",
      clientShort: "Fernanda",
      address: "215 Cedar Ave",
      start: "08:00",
      end: "11:30",
      status: "on_site",
      team: "Equipe B + Diego",
      dateYmd: null, // filled as today
    },
    {
      id: "wo-1041",
      number: "1041",
      title: "Lixamento",
      client: "Lucas Ferreira",
      clientShort: "Lucas",
      address: "88 Birch Ln",
      start: "14:00",
      end: "18:00",
      status: "scheduled",
      team: "Equipe A · Diego, Marcos",
      dateYmd: null,
    },
  ];

  /** Activity types for ponto */
  const activities = {
    on_site_1039: {
      id: "on_site_1039",
      kind: "on_site",
      label: "Na obra",
      title: "Na obra · #1039 Fernanda",
      sub: "215 Cedar Ave",
      workOrderId: "wo-1039",
    },
    on_site_1041: {
      id: "on_site_1041",
      kind: "on_site",
      label: "Na obra",
      title: "Na obra · #1041 Lucas",
      sub: "88 Birch Ln",
      workOrderId: "wo-1041",
    },
    travel: {
      id: "travel",
      kind: "travel",
      label: "Deslocamento",
      title: "Deslocamento",
      sub: "Entre obras ou até o depósito",
      workOrderId: null,
    },
    shopping: {
      id: "shopping",
      kind: "shopping",
      label: "Compra de material",
      title: "Compra de material",
      sub: "Loja ou distribuidor",
      workOrderId: null,
    },
    break: {
      id: "break",
      kind: "break",
      label: "Pausa · não paga",
      title: "Pausa · não paga",
      sub: "Almoço ou intervalo, não conta",
      workOrderId: null,
    },
  };

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function ymdLocal(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }

  function startOfWeekMon(d) {
    const x = new Date(d);
    x.setHours(12, 0, 0, 0);
    const day = x.getDay(); // 0 Sun
    const diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  const DOW_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const DOW_LONG = [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ];
  const MON_SHORT = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];

  function formatDayMeta(d) {
    const x = new Date(d);
    const dow = DOW_LONG[x.getDay()];
    return `${dow}, ${x.getDate()} ${MON_SHORT[x.getMonth()]}`;
  }

  function formatDayShort(d) {
    const x = new Date(d);
    return `${DOW_SHORT[x.getDay()]} ${x.getDate()}`;
  }

  function greeting(now) {
    const h = (now || new Date()).getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  }

  function statusLabel(status) {
    const map = {
      on_site: "No local",
      scheduled: "Agendada",
      en_route: "A caminho",
      done: "Concluída",
      in_progress: "Em andamento",
    };
    return map[status] || status;
  }

  function statusBadgeClass(status) {
    if (status === "on_site") return "cm-badge--site";
    if (status === "in_progress") return "cm-badge--progress";
    return "cm-badge--sched";
  }

  function buildTodayJobs(now) {
    const today = ymdLocal(now || new Date());
    return jobs.map((j) => ({ ...j, dateYmd: today }));
  }

  /** Week strip markers: green = done-ish, orange = has jobs */
  function weekDots(weekStart) {
    const today = ymdLocal(new Date());
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const ymd = ymdLocal(d);
      const isToday = ymd === today;
      let dots = [];
      if (i < 4) dots = ["green"];
      else if (i === 4) dots = ["orange", "orange"]; // today mock
      else if (i === 5) dots = ["orange"];
      out.push({
        date: d,
        ymd,
        isToday,
        label: isToday ? "Hoje" : DOW_SHORT[d.getDay()],
        dayNum: d.getDate(),
        dots,
      });
    }
    return out;
  }

  function weekRangeLabel(weekStart) {
    const end = addDays(weekStart, 6);
    const a = weekStart.getDate();
    const b = end.getDate();
    const mon = MON_SHORT[end.getMonth()];
    return `${a} – ${b} ${mon}`;
  }

  /** Open shift mock: clocked in 08:12, on site #1039 since 08:29 */
  function openShift(now) {
    const n = now || new Date();
    const clockIn = new Date(n);
    clockIn.setHours(8, 12, 0, 0);
    const since = new Date(n);
    since.setHours(8, 29, 0, 0);
    if (clockIn > n) {
      clockIn.setDate(clockIn.getDate() - 1);
      since.setDate(since.getDate() - 1);
    }
    return {
      clockInAt: clockIn.toISOString(),
      clockInLabel: `${pad(clockIn.getHours())}:${pad(clockIn.getMinutes())}`,
      activityId: "on_site_1039",
      activitySinceAt: since.toISOString(),
      activitySinceLabel: `${pad(since.getHours())}:${pad(since.getMinutes())}`,
      paused: false,
    };
  }

  function hoursWeek(now) {
    const n = now || new Date();
    const d0 = n;
    const d1 = addDays(n, -1);
    const d2 = addDays(n, -2);
    const d3 = addDays(n, -3);
    return {
      status: "draft",
      totalLabel: "34h 33m",
      productionLabel: "1,390 ft²",
      payEstimate: "$564",
      days: [
        {
          id: "d0",
          label: `Hoje · ${formatDayMeta(d0)}`,
          total: "3h 53m",
          sub: "Em andamento · #1039 Fernanda",
          bar: { obra: 88, travel: 12, shop: 0 },
        },
        {
          id: "d1",
          label: formatDayMeta(d1),
          total: "6h 40m",
          sub: "#1041 Lucas",
          bar: { obra: 92, travel: 8, shop: 0 },
        },
        {
          id: "d2",
          label: formatDayMeta(d2),
          total: "9h 15m",
          sub: "#1039 Fernanda · pausa 30m",
          bar: { obra: 85, travel: 10, shop: 5 },
        },
        {
          id: "d3",
          label: formatDayMeta(d3),
          total: "8h 15m",
          sub: "#1039 Fernanda · pausa 30m",
          bar: { obra: 90, travel: 10, shop: 0 },
        },
      ],
    };
  }

  function elapsedPaidMs(shift, now) {
    const n = now || new Date();
    const start = new Date(shift.clockInAt).getTime();
    let ms = Math.max(0, n.getTime() - start);
    if (shift.paused) {
      // mock: treat pause as freezing — caller passes frozenAt
      return ms;
    }
    return ms;
  }

  function formatHms(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  global.__campoMock = {
    VER,
    user,
    jobs,
    activities,
    buildTodayJobs,
    weekDots,
    weekRangeLabel,
    startOfWeekMon,
    addDays,
    ymdLocal,
    formatDayMeta,
    formatDayShort,
    greeting,
    statusLabel,
    statusBadgeClass,
    openShift,
    hoursWeek,
    elapsedPaidMs,
    formatHms,
    DOW_SHORT,
    MON_SHORT,
  };
})(typeof window !== "undefined" ? window : globalThis);
