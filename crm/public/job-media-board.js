(function () {
  async function api(url) {
    const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    const j = await r.json().catch(() => ({}));
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

  async function boot() {
    const json = await api("/api/job-media/board?days=3");
    const jobs = json.data?.jobs || [];
    const feed = json.data?.feed || [];

    const feedEl = document.getElementById("jmbFeed");
    feedEl.innerHTML = feed.length
      ? feed
          .map(
            (p) => `<a href="job-detail.html?id=${encodeURIComponent(p.job_id)}">
          <img src="${escapeHtml(p.thumb_url || p.url)}" alt="" />
          <span>
            <strong>#${escapeHtml(String(p.job_number ?? "—"))}</strong> ${escapeHtml(p.job_title || "")}<br/>
            <small>${escapeHtml(p.stage || "photo")} · ${escapeHtml((p.created_at || "").slice(0, 16).replace("T", " "))}</small>
          </span>
        </a>`,
          )
          .join("")
      : "<p>No recent photos.</p>";

    const list = document.getElementById("jmbJobs");
    list.innerHTML = jobs
      .map(
        (j) => `<a class="jmb-job" href="${escapeHtml(j.detail_url)}">
        <span>
          <strong>#${escapeHtml(String(j.number ?? "—"))}</strong> ${escapeHtml(j.title || "")}<br/>
          <small>${escapeHtml(j.address || "No address")} · ${escapeHtml(j.status)}</small>
        </span>
        <span>${j.stale ? '<span class="jmb-stale">Stale</span>' : j.last_photo ? "OK" : "No photo"}</span>
      </a>`,
      )
      .join("");

    const map = L.map("jmbMap").setView([39.5, -98.35], 4);
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
        `<strong>#${escapeHtml(String(j.number ?? ""))}</strong><br/>${escapeHtml(j.title || "")}<br/><a href="${escapeHtml(j.detail_url)}">Open job</a>`,
      );
      bounds.push([lat, lng]);
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] });
  }

  boot().catch((e) => {
    document.getElementById("jmbFeed").textContent = e.message || "Failed to load board";
  });
})();
