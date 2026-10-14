(function () {
  function money(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function fdate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  }

  async function api(path) {
    const r = await fetch(path, { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  async function load() {
    const banner = document.getElementById("refBanner");
    const body = document.getElementById("refBody");
    try {
      const j = await api("/api/referrals");
      const s = j.data.settings || {};
      const rewards = j.data.rewards || [];
      banner.innerHTML = s.enabled
        ? `<span><b>Programa ativo</b> · ${esc(String(s.percent))}% do valor da fatura paga · link público no cadastro do Particular</span>
           <a href="configuracoes.html#indicacoes">Configurar</a>`
        : `<span><b>Programa desativado</b> — ative em Configurações para começar a creditar cashback.</span>
           <a href="configuracoes.html#indicacoes">Ativar agora</a>`;
      if (!rewards.length) {
        body.innerHTML = `<tr><td colspan="6" class="ref-empty">Nenhum cashback creditado ainda. Cadastre o indicador no cliente e aguarde a fatura paga.</td></tr>`;
        return;
      }
      body.innerHTML = rewards
        .map(
          (r) => `<tr>
          <td>${esc(fdate(r.credited_at))}</td>
          <td><a href="customers.html?id=${encodeURIComponent(r.referrer.id)}">${esc(r.referrer.name)}</a></td>
          <td><a href="customers.html?id=${encodeURIComponent(r.referred.id)}">${esc(r.referred.name)}</a></td>
          <td class="ref-amt">${money(r.project_amount)}</td>
          <td>${esc(String(r.percent))}%</td>
          <td class="ref-amt">${money(r.reward_amount)}</td>
        </tr>`,
        )
        .join("");
    } catch (e) {
      banner.textContent = e.message || "Não foi possível carregar.";
      body.innerHTML = `<tr><td colspan="6" class="ref-empty">${esc(e.message || "Erro")}</td></tr>`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
