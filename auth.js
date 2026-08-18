(() => {
  const PASSWORD_ITERATIONS = 150000;
  let currentUser = null;

  async function request(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.error || 'Anfrage fehlgeschlagen.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function esc(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function bytesToBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }

  function createSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
  }

  async function derivePasswordVerifier(password, salt) {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: base64UrlToBytes(salt),
        iterations: PASSWORD_ITERATIONS
      },
      material,
      256
    );

    return bytesToBase64Url(new Uint8Array(bits));
  }

  function authMarkup(mode = 'login') {
    const register = mode === 'register';
    return `
      <div class="auth-screen" id="auth-screen">
        <section class="auth-box" aria-labelledby="auth-title">
          <header class="auth-head">
            <strong>QRPass</strong>
            <span>Maschinenbuch</span>
          </header>

          <div class="auth-tabs" role="tablist" aria-label="Konto">
            <button type="button" class="${register ? '' : 'active'}" data-auth-mode="login">Anmelden</button>
            <button type="button" class="${register ? 'active' : ''}" data-auth-mode="register">Firma registrieren</button>
          </div>

          <form id="auth-form" class="auth-form" data-mode="${register ? 'register' : 'login'}">
            <div>
              <h1 id="auth-title">${register ? 'Firma registrieren' : 'Anmelden'}</h1>
              <p>${register ? 'Ein Konto für Ihre Firma erstellen.' : 'Mit Ihrem Firmenkonto anmelden.'}</p>
            </div>

            <div id="auth-error" class="auth-error" hidden></div>

            ${register ? `
              <label class="auth-field">
                <span>Firmenname</span>
                <input name="companyName" autocomplete="organization" required maxlength="180" placeholder="Firmenname">
              </label>` : ''}

            <label class="auth-field">
              <span>E-Mail</span>
              <input name="email" type="email" inputmode="email" autocomplete="email" required maxlength="254" placeholder="name@firma.de">
            </label>

            <label class="auth-field">
              <span>Passwort</span>
              <input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required minlength="8" maxlength="200" placeholder="${register ? 'Mindestens 8 Zeichen' : 'Passwort'}">
            </label>

            <button class="auth-submit" type="submit">${register ? 'Konto erstellen' : 'Anmelden'}</button>
          </form>
        </section>
      </div>`;
  }

  function showAuth(mode = 'login') {
    document.querySelector('#auth-screen')?.remove();
    document.body.insertAdjacentHTML('beforeend', authMarkup(mode));
    document.body.classList.add('auth-locked');
    bindAuthForm();
  }

  function setError(text) {
    const error = document.querySelector('#auth-error');
    if (!error) return;
    error.textContent = text;
    error.hidden = !text;
  }

  function bindAuthForm() {
    const form = document.querySelector('#auth-form');
    if (!form) return;
    form.addEventListener('submit', submitAuth);
    setTimeout(() => form.querySelector('input')?.focus(), 50);
  }

  async function submitAuth(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const mode = form.dataset.mode;
    const submit = form.querySelector('[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    const email = String(values.email || '').trim().toLowerCase();
    const password = String(values.password || '');

    submit.disabled = true;
    submit.textContent = mode === 'register' ? 'Konto wird erstellt …' : 'Anmeldung …';
    setError('');

    try {
      if (!window.crypto?.subtle) throw new Error('Sichere Passwortverarbeitung wird auf diesem Gerät nicht unterstützt.');

      if (mode === 'register') {
        const salt = createSalt();
        const verifier = await derivePasswordVerifier(password, salt);
        await request('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            companyName: values.companyName,
            email,
            passwordSalt: salt,
            passwordVerifier: verifier
          })
        });
      } else {
        const saltResult = await request(`/api/auth/salt?email=${encodeURIComponent(email)}`);
        const verifier = await derivePasswordVerifier(password, saltResult.salt);
        await request('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, passwordVerifier: verifier })
        });
      }

      location.reload();
    } catch (error) {
      submit.disabled = false;
      submit.textContent = mode === 'register' ? 'Konto erstellen' : 'Anmelden';
      setError(error.message);
    }
  }

  async function logout() {
    const buttons = document.querySelectorAll('[data-auth-action="logout"]');
    buttons.forEach(button => {
      button.disabled = true;
      button.textContent = 'Abmeldung …';
    });
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } catch {
      // Cookie wird beim Neuladen erneut geprüft.
    }
    location.reload();
  }

  function injectLogout() {
    if (!currentUser) return;
    const actions = document.querySelector('.company-setup-actions');
    if (!actions || actions.querySelector('[data-auth-action="logout"]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button auth-logout';
    button.dataset.authAction = 'logout';
    button.textContent = 'Abmelden';
    actions.prepend(button);
  }

  async function init() {
    try {
      const result = await request('/api/auth/session');
      currentUser = result.user || null;
      document.body.classList.remove('auth-locked');
      document.querySelector('#auth-screen')?.remove();
      injectLogout();
    } catch (error) {
      showAuth('login');
    }
  }

  document.addEventListener('click', event => {
    const modeButton = event.target.closest('[data-auth-mode]');
    if (modeButton) {
      showAuth(modeButton.dataset.authMode);
      return;
    }

    const logoutButton = event.target.closest('[data-auth-action="logout"]');
    if (logoutButton) logout();
  });

  const observer = new MutationObserver(() => injectLogout());
  observer.observe(document.body, { childList: true, subtree: true });

  window.QRPassAuth = {
    showLogin: () => showAuth('login'),
    get user() { return currentUser; }
  };

  init();
})();