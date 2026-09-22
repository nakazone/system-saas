/* global sessionStorage */
(function () {
  const TOKEN_KEY = 'sf_builder_token';
  const RETURN_KEY = 'sf_builder_return_url';

  window.builderAuth = {
    getToken() {
      return sessionStorage.getItem(TOKEN_KEY);
    },
    setToken(t) {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    },
    async fetch(path, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      const token = this.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch(path, { ...opts, headers });
      if (r.status === 401) {
        this.setToken(null);
        const stem = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
        const authPages = ['builder-login', 'builder-forgot-password', 'builder-reset-password'];
        if (!authPages.includes(stem)) {
          sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);
          location.href = 'builder-login.html?expired=1';
        }
      }
      return r;
    },
    requireAuth() {
      if (!this.getToken()) {
        sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);
        location.href = 'builder-login.html';
        return false;
      }
      return true;
    },
  };

  const form = document.getElementById('loginForm');
  if (form) {
    const params = new URLSearchParams(location.search);
    if (params.get('expired') === '1') {
      const err = document.getElementById('loginError');
      if (err) {
        err.textContent = 'Your session expired. Please sign in again.';
        err.style.display = 'block';
      }
    }
    if (params.get('reset') === '1') {
      const err = document.getElementById('loginError');
      if (err) {
        err.style.display = 'block';
        err.style.color = '#16a34a';
        err.textContent = 'Password updated. You can sign in now.';
      }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('loginError');
      err.style.display = 'none';
      err.style.color = '#dc2626';
      try {
        const r = await fetch('/api/builder-auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('email').value.trim(),
            password: document.getElementById('password').value,
          }),
        });
        const j = await r.json();
        if (!r.ok || !j.success) throw new Error(j.error || 'Login failed');
        window.builderAuth.setToken(j.data.token);
        const returnUrl = sessionStorage.getItem(RETURN_KEY);
        sessionStorage.removeItem(RETURN_KEY);
        if (j.data.builder?.password_must_change) {
          location.href = 'builder-change-password.html?required=1';
          return;
        }
        location.href = returnUrl && returnUrl.includes('builder-') ? returnUrl : 'builder-portal.html';
      } catch (ex) {
        err.textContent = ex.message || 'Login failed';
        err.style.display = 'block';
      }
    });
  }
})();
