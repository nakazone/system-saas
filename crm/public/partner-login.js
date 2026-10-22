(function () {
  const form = document.getElementById('partnerLoginForm');
  const button = document.getElementById('partnerLoginButton');
  const error = document.getElementById('partnerLoginError');
  const workspaceFromLink = new URLSearchParams(location.search).get('workspace');
  if (workspaceFromLink) document.getElementById('workspace').value = workspaceFromLink;

  async function request(url, options) {
    const response = await fetch(url, { credentials: 'include', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Não foi possível concluir o acesso.');
    return body;
  }

  async function init() {
    try {
      const state = await request('/api/partner-auth/session');
      if (state.authenticated) location.replace('partner-portal.html');
    } catch (_) {
      // A tela de login também é usada sem uma sessão ativa.
    }
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    button.disabled = true;
    button.textContent = 'Entrando…';
    try {
      const workspace = document.getElementById('workspace').value.trim();
      await request('/api/partner-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('partnerEmail').value.trim(),
          password: document.getElementById('partnerPassword').value,
          ...(workspace ? { workspace } : {}),
        }),
      });
      location.replace('partner-portal.html');
    } catch (err) {
      error.textContent = err.message || 'Não foi possível entrar.';
      error.hidden = false;
      button.disabled = false;
      button.textContent = 'Entrar no portal';
    }
  });

  void init();
})();
