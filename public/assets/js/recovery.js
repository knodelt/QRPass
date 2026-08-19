(() => {
  let resetMailEnabled = false;

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
    if (!response.ok) throw new Error(data?.error || 'Anfrage fehlgeschlagen.');
    return data;
  }

  function createSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function closeRecovery() {
    document.querySelector('#recovery-backdrop')?.remove();
  }

  function recoveryShell(title, body) {
    closeRecovery();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="recovery-backdrop" id="recovery-backdrop">
        <section class="recovery-panel" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
          <header class="recovery-head">
            <div><small>QRPass</small><h2 id="recovery-title">${title}</h2></div>
            <button type="button" class="recovery-close" data-recovery-action="close" aria-label="Schließen">×</button>
          </header>
          <div class="recovery-body">${body}</div>
        </section>
      </div>`);
  }

  function showRequestForm() {
    recoveryShell('Passwort zurücksetzen', `
      <p>Geben Sie die E-Mail-Adresse des Admin-Kontos ein. Wenn ein Konto vorhanden ist, sendet QRPass einen zeitlich begrenzten Reset-Link.</p>
      <form id="recovery-request-form" class="recovery-form">
        <label class="auth-field"><span>E-Mail</span><input name="email" type="email" inputmode="email" autocomplete="email" required></label>
        <button class="button button-primary" type="submit">Reset-Link anfordern</button>
        <div class="recovery-message" id="recovery-request-message" hidden></div>
      </form>`);
    document.querySelector('#recovery-request-form')?.addEventListener('submit', submitRequest);
  }

  async function submitRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const message = form.querySelector('#recovery-request-message');
    const email = String(new FormData(form).get('email') || '').trim().toLowerCase();
    submit.disabled = true;
    submit.textContent = 'Wird gesendet …';
    message.hidden = true;
    try {
      const result = await request('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      message.textContent = result.mailConfigured
        ? 'Wenn ein Konto mit dieser E-Mail-Adresse existiert, wurde ein Reset-Link versendet.'
        : 'Der E-Mail-Versand für Passwort-Resets ist noch nicht eingerichtet.';
      message.classList.toggle('error', !result.mailConfigured);
      message.hidden = false;
    } catch (error) {
      message.textContent = error.message;
      message.classList.add('error');
      message.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Reset-Link anfordern';
    }
  }

  async function showResetForm(token) {
    try {
      await request(`/api/auth/password-reset/validate?token=${encodeURIComponent(token)}`);
    } catch (error) {
      recoveryShell('Reset-Link ungültig', `<div class="recovery-message error">${error.message}</div><button class="button" data-recovery-action="finish">Zur Anmeldung</button>`);
      return;
    }

    recoveryShell('Neues Passwort', `
      <p>Der Link ist gültig. Legen Sie jetzt ein neues Admin-Passwort fest.</p>
      <form id="recovery-complete-form" class="recovery-form">
        <label class="auth-field"><span>Neues Passwort</span><input name="password" type="password" autocomplete="new-password" required minlength="8"></label>
        <label class="auth-field"><span>Passwort wiederholen</span><input name="repeat" type="password" autocomplete="new-password" required minlength="8"></label>
        <button class="button button-primary" type="submit">Passwort speichern</button>
        <div class="recovery-message" id="recovery-complete-message" hidden></div>
      </form>`);

    document.querySelector('#recovery-complete-form')?.addEventListener('submit', event => submitReset(event, token));
  }

  async function submitReset(event, token) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const message = form.querySelector('#recovery-complete-message');
    const values = Object.fromEntries(new FormData(form).entries());
    const password = String(values.password || '');
    const repeat = String(values.repeat || '');

    if (password.length < 8) {
      message.textContent = 'Das Passwort muss mindestens 8 Zeichen haben.';
      message.classList.add('error');
      message.hidden = false;
      return;
    }
    if (password !== repeat) {
      message.textContent = 'Die Passwörter stimmen nicht überein.';
      message.classList.add('error');
      message.hidden = false;
      return;
    }
    if (!window.QRPassAuth?.deriveVerifier) {
      message.textContent = 'Sichere Passwortverarbeitung ist nicht verfügbar.';
      message.classList.add('error');
      message.hidden = false;
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Wird gespeichert …';
    message.hidden = true;
    try {
      const newSalt = createSalt();
      const newVerifier = await window.QRPassAuth.deriveVerifier(password, newSalt);
      await request('/api/auth/password-reset/complete', {
        method: 'POST',
        body: JSON.stringify({ token, newSalt, newVerifier })
      });
      const cleanUrl = `${location.pathname}${location.hash || ''}`;
      history.replaceState(null, '', cleanUrl);
      recoveryShell('Passwort geändert', `
        <div class="recovery-message">Das neue Passwort wurde gespeichert. Alle alten Admin-Sitzungen wurden beendet.</div>
        <button class="button button-primary" data-recovery-action="finish">Jetzt anmelden</button>`);
    } catch (error) {
      message.textContent = error.message;
      message.classList.add('error');
      message.hidden = false;
      submit.disabled = false;
      submit.textContent = 'Passwort speichern';
    }
  }

  function injectForgot() {
    if (!resetMailEnabled) return;
    const form = document.querySelector('#auth-form[data-mode="login"]');
    if (!form || form.querySelector('[data-recovery-action="request"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'auth-forgot';
    button.dataset.recoveryAction = 'request';
    button.textContent = 'Passwort vergessen?';
    form.append(button);
  }

  async function initStatus() {
    try {
      const result = await request('/api/auth/password-reset/status');
      resetMailEnabled = Boolean(result.enabled);
      injectForgot();
    } catch {
      resetMailEnabled = false;
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-recovery-action]');
    if (!button) return;
    const action = button.dataset.recoveryAction;
    if (action === 'request') showRequestForm();
    if (action === 'close') closeRecovery();
    if (action === 'finish') location.href = location.pathname;
  });

  const observer = new MutationObserver(injectForgot);
  observer.observe(document.body, { childList: true, subtree: true });

  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) showResetForm(resetToken);
  initStatus();
})();
