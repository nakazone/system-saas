(function () {
  let map = null;

  async function api(url) {
    const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      location.href = "/login.html";
      throw new Error("unauth");
    }
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function statusLabel(status) {
    const map = {
      draft: "Draft",
      scheduled: "Scheduled",
      in_progress: "Em progresso",
      completed: "Concluído",
      canceled: "Cancelado",
    };
    return map[status] || status || "—";
  }

  function stageLabel(stage) {
    const map = { before: "Antes", during: "Durante", after: "Depois" };
    return map[stage] || "Foto";
  }

  function fmtWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function renderOverview(jobs, feed) {
    const total = jobs.length;
    const ok = jobs.filter((j) => j.last_photo && !j.stale).length;
    const stale = jobs.filter((j) => j.stale || !j.last_photo).length;
    const elJobs = document.getElementById("jmbStatJobs");
    const elOk = document.getElementById("jmbStatOk");
    const elStale = document.getElementById("jmbStatStale");
    if (elJobs) elJobs.textContent = String(total);
    if (elOk) elOk.textContent = String(ok);
    if (elStale) elStale.textContent = String(stale);
    const count = document.getElementById("jmbJobsCount");
    if (count) count.textContent = `(${total})`;
    void feed;
  }

  function renderFeed(feed) {
    const feedEl = document.getElementById("jmbFeed");
    if (!feedEl) return;
    if (!feed.length) {
      feedEl.innerHTML = '<p class="jobs-empty" style="padding:1rem 0">Ainda sem fotos recentes.</p>';
      return;
    }
    feedEl.innerHTML = feed
      .map(
        (p) => `<a class="jmb-feed__item" href="job-detail.html?id=${encodeURIComponent(p.job_id)}">
          <img src="${escapeHtml(p.thumb_url || p.url)}" alt="" loading="lazy" />
          <span>
            <strong class="jobs-table__client">#${escapeHtml(String(p.job_number ?? "—"))}</strong>
            ${escapeHtml(p.job_title || "")}<br/>
            <span class="jobs-table__muted">${escapeHtml(stageLabel(p.stage))} · ${escapeHtml(fmtWhen(p.created_at))}</span>
          </span>
        </a>`,
      )
      .join("");
  }

  function renderJobs(jobs) {
    const body = document.getElementById("jmbJobsBody");
    if (!body) return;
    if (!jobs.length) {
      body.innerHTML = '<tr><td colspan="5" class="jobs-empty">Nenhum job aberto no período.</td></tr>';
      return;
    }
    body.innerHTML = jobs
      .map((j) => {
        const proof = j.stale
          ? '<span class="jmb-badge jmb-badge--warn">Atrasado</span>'
          : j.last_photo
            ? '<span class="jmb-badge jmb-badge--ok">OK</span>'
            : '<span class="jmb-badge">Sem foto</span>';
        return `<tr>
          <td>
            <a class="jobs-table__client" href="${escapeHtml(j.detail_url)}">#${escapeHtml(String(j.number ?? "—"))}</a>
            <div class="jobs-table__muted">${escapeHtml(j.title || "")}</div>
          </td>
          <td class="jobs-table__muted">${escapeHtml(j.address || "—")}</td>
          <td><span class="job-status is-${escapeHtml(j.status || "draft")}">${escapeHtml(statusLabel(j.status))}</span></td>
          <td class="jobs-table__muted">${escapeHtml(fmtWhen(j.last_photo?.created_at))}</td>
          <td>${proof}</td>
        </tr>`;
      })
      .join("");
  }

  function renderMap(jobs) {
    const el = document.getElementById("jmbMap");
    if (!el || typeof L === "undefined") return;
    if (map) {
      map.remove();
      map = null;
    }
    map = L.map(el).setView([39.5, -98.35], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);

    const bounds = [];
    for (const j of jobs) {
      const lat = j.last_photo?.lat;
      const lng = j.last_photo?.lng;
      if (lat == null || lng == null) continue;
      const m = L.marker([lat, lng]).addTo(map);
      m.bindPopup(
        `<strong>#${escapeHtml(String(j.number ?? ""))}</strong><br/>${escapeHtml(j.title || "")}<br/><a href="${escapeHtml(j.detail_url)}">Abrir job</a>`,
      );
      bounds.push([lat, lng]);
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] });
    setTimeout(() => map && map.invalidateSize(), 80);
  }

  async function load() {
    const json = await api("/api/job-media/board?days=3");
    const jobs = json.data?.jobs || [];
    const feed = json.data?.feed || [];
    renderOverview(jobs, feed);
    renderFeed(feed);
    renderJobs(jobs);
    renderMap(jobs);
  }

  document.getElementById("jmbReload")?.addEventListener("click", () => {
    load().catch((e) => {
      if (window.crmToast?.show) window.crmToast.show(e.message || "Falha ao atualizar", { type: "error" });
    });
  });

  load().catch((e) => {
    const feedEl = document.getElementById("jmbFeed");
    if (feedEl) {
      feedEl.innerHTML = `<p class="jobs-empty" style="padding:1rem 0">${escapeHtml(e.message || "Falha ao carregar")}</p>`;
    }
    const body = document.getElementById("jmbJobsBody");
    if (body) {
      body.innerHTML = `<tr><td colspan="5" class="jobs-empty">${escapeHtml(e.message || "Falha ao carregar")}</td></tr>`;
    }
  });
})();
