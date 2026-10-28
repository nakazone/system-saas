(function () {
  const form = document.getElementById('partnerLoginForm');
  const button = document.getElementById('partnerLoginButton');
  const error = document.getElementById('partnerLoginError');
  const workspaceFromLink = new URLSearchParams(location.search).get('workspace');
  if (workspaceFromLink) document.getElementById('workspace').value = workspaceFromLink;

  async function request(url, options) {
    const response = await fetch(url, { credentials: 'include', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not complete the sign-in.');
    return body;
  }

  async function init() {
    try {
      if (new URLSearchParams(location.search).get('switch') === '1') {
        await request('/api/partner-auth/exchange', { method: 'POST' });
        location.replace('partner-portal.html');
        return;
      }
      const state = await request('/api/partner-auth/session');
      if (state.authenticated) location.replace('partner-portal.html');
    } catch (_) {
      if (new URLSearchParams(location.search).get('switch') === '1') {
        error.textContent = 'Could not switch company. Sign in again.';
        error.hidden = false;
      }
      // The sign-in screen is also shown without an active session.
    }
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    button.disabled = true;
    button.textContent = 'Signing in…';
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
      error.textContent = err.message || 'Could not sign in.';
      error.hidden = false;
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });

  void init();
})();
