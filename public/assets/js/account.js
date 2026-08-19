(() => {
  let accountData = null;

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

  function esc(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function isAdmin() {
    return document.body.dataset.role === 'admin';
  }

  function createSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function injectEntry() {
    if (!isAdmin()) return;
    const form = document.querySelector('#company-setup-form');
    const actions = form?.querySelector('.company-setup-actions');
    if (!form || !actions || form.querySelector('.account-admin-entry')) return;

    const block = document.createElement('div');
    block.className = 'account-admin-entry';
    block.innerHTML = `
      <div>
        <strong>Konto & Daten</strong>
        <small>Passwort, Datensicherung, Firmen-Code und Firmenkonto verwalten.</small>
      </div>
      <button type="button" class="button" data-account-action="open">Verwalten</button>`;
    actions.before(block);
  }

  function closePanel() {
    document.querySelector('#account-backdrop')?.remove();
    accountData = null;
  }

  function panelMarkup(data) {
    return `
      <div class="account-backdrop" id="account-backdrop">
        <section class="account-panel" role="dialog" aria-modal="true" aria-labelledby="account-title">
          <header class="account-panel-head">
            <div><small>Admin</small><h2 id="account-title">Konto & Daten</h2></div>
            <button type="button" class="account-close" data-account-action="close" aria-label="Schließen">×</button>
          </header>

          <div class="account-panel-body">
            <section class="account-section">
              <div class="account-section-head">
                <div><strong>Admin-Konto</strong><small>${esc(data.email || '')}</small></div>
              </div>
              <form id="account-password-form" class="account-form">
                <label class="auth-field"><span>Aktuelles Passwort</span><input name="currentPassword" type="password" autocomplete="current-password" required minlength="8"></label>
                <label class="auth-field"><span>Neues Passwort</span><input name="newPassword" type="password" autocomplete="new-password" required minlength="8"></label>
                <label class="auth-field"><span>Neues Passwort wiederholen</span><input name="repeatPassword" type="password" autocomplete="new-password" required minlength="8"></label>
                <button class="button button-primary" type="submit">Passwort ändern</button>
                <div class="account-message" data-account-message="password" hidden></div>
              </form>
            </section>

            <section class="account-section">
              <div class="account-section-head">
                <div><strong>Datensicherung</strong><small>Aktive und archivierte Maschinen inklusive Störungen, Wartungen und Verlauf.</small></div>
                <button type="button" class="button" data-account-action="export">CSV herunterladen</button>
              </div>
            </section>

            <section class="account-section">
              <div class="account-section-head account-code-head">
                <div>
                  <strong>Mitarbeiter-Firmen-Code</strong>
                  <small>Aktueller Code</small>
                  <code id="account-company-code">${esc(data.companyCode || '–')}</code>
                </div>
                <button type="button" class="button" data-account-action="rotate-code">Neuen Code erzeugen</button>
              </div>
              <p class="account-hint">Beim Erzeugen eines neuen Codes werden alle Mitarbeiter abgemeldet. Ihre PINs bleiben erhalten.</p>
            </section>

            <section class="account-section account-danger-zone">
              <div class="account-section-head">
                <div><strong>Firmenkonto löschen</strong><small>Löscht Maschinen, Verläufe, Mitarbeiter und Firmeneinstellungen dauerhaft.</small></div>
              </div>
              <form id="account-delete-form" class="account-form account-delete-form">
                <label class="auth-field"><span>Aktuelles Passwort</span><input name="password" type="password" autocomplete="current-password" required minlength="8"></label>
                <label class="auth-field"><span>Zur Bestätigung LÖSCHEN eingeben</span><input name="confirmation" autocomplete="off" required placeholder="LÖSCHEN"></label>
                <button class="button account-danger-button" type="submit">Firmenkonto endgültig löschen</button>
                <div class="account-message danger" data-account-message="delete" hidden></div>
              </form>
            </section>
          </div>
        </section>
      </div>`;
  }

  function setMessage(name, text, isError = false) {
    const el = document.querySelector(`[data-account-message="${name}"]`);
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle('error', isError);
  }

  async function openPanel() {
    if (!isAdmin()) return;
    try {
      accountData = await request('/api/account');
      document.querySelector('#account-backdrop')?.remove();
      document.body.insertAdjacentHTML('beforeend', panelMarkup(accountData));
      document.querySelector('#account-password-form')?.addEventListener('submit', changePassword);
      document.querySelector('#account-delete-form')?.addEventListener('submit', deleteAccount);
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    const currentPassword = String(values.currentPassword || '');
    const newPassword = String(values.newPassword || '');
    const repeat = String(values.repeatPassword || '');

    if (newPassword.length < 8) return setMessage('password', 'Das neue Passwort muss mindestens 8 Zeichen haben.', true);
    if (newPassword !== repeat) return setMessage('password', 'Die neuen Passwörter stimmen nicht überein.', true);
    if (!window.QRPassAuth?.deriveVerifier) return setMessage('password', 'Sichere Passwortverarbeitung ist nicht verfügbar.', true);

    submit.disabled = true;
    submit.textContent = 'Wird geändert …';
    setMessage('password', '');

    try {
      const challenge = await request('/api/account/password-salt');
      const currentVerifier = await window.QRPassAuth.deriveVerifier(currentPassword, challenge.salt);
      const newSalt = createSalt();
      const newVerifier = await window.QRPassAuth.deriveVerifier(newPassword, newSalt);
      await request('/api/account/password', {
        method: 'POST',
        body: JSON.stringify({ currentVerifier, newSalt, newVerifier })
      });
      form.reset();
      setMessage('password', 'Passwort wurde geändert.');
      if (typeof toast === 'function') toast('Passwort geändert');
    } catch (error) {
      setMessage('password', error.message, true);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Passwort ändern';
    }
  }

  async function exportCsv(button) {
    button.disabled = true;
    const old = button.textContent;
    button.textContent = 'Wird erstellt …';
    try {
      const response = await fetch('/api/account/export.csv', { cache: 'no-store' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Export fehlgeschlagen.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `qrpass-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      if (typeof toast === 'function') toast('CSV-Export erstellt');
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  async function rotateCode(button) {
    const confirmed = window.confirm(
      'Neuen Firmen-Code erzeugen?\n\nDer bisherige Code funktioniert danach nicht mehr und alle angemeldeten Mitarbeiter werden abgemeldet.'
    );
    if (!confirmed) return;

    button.disabled = true;
    try {
      const result = await request('/api/account/company-code', { method: 'POST' });
      const code = document.querySelector('#account-company-code');
      if (code) code.textContent = result.companyCode;
      accountData.companyCode = result.companyCode;
      if (typeof toast === 'function') toast('Neuer Firmen-Code erstellt');
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function deleteAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    const password = String(values.password || '');
    const confirmation = String(values.confirmation || '').trim().toUpperCase();

    if (confirmation !== 'LÖSCHEN') return setMessage('delete', 'Bitte LÖSCHEN exakt eingeben.', true);
    if (!window.QRPassAuth?.deriveVerifier) return setMessage('delete', 'Sichere Passwortverarbeitung ist nicht verfügbar.', true);

    const finalConfirm = window.confirm(
      `Firmenkonto „${accountData?.companyName || ''}“ wirklich ENDGÜLTIG löschen?\n\nAlle Maschinen, Störungen, Wartungen, Mitarbeiter und Einstellungen werden dauerhaft gelöscht. Das kann nicht rückgängig gemacht werden.`
    );
    if (!finalConfirm) return;

    submit.disabled = true;
    submit.textContent = 'Konto wird gelöscht …';
    setMessage('delete', '');

    try {
      const challenge = await request('/api/account/password-salt');
      const currentVerifier = await window.QRPassAuth.deriveVerifier(password, challenge.salt);
      await request('/api/account/delete', {
        method: 'POST',
        body: JSON.stringify({ currentVerifier, confirmation })
      });
      try {
        localStorage.removeItem('qrpass-v0.1');
        localStorage.removeItem('qrpass-v0.2-migrated');
        sessionStorage.clear();
      } catch {}
      location.href = location.pathname;
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Firmenkonto endgültig löschen';
      setMessage('delete', error.message, true);
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-account-action]');
    if (!button) return;
    const action = button.dataset.accountAction;
    if (action === 'open') openPanel();
    if (action === 'close') closePanel();
    if (action === 'export') exportCsv(button);
    if (action === 'rotate-code') rotateCode(button);
  });

  document.addEventListener('qrpass:auth', () => setTimeout(injectEntry, 0));
  const observer = new MutationObserver(injectEntry);
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(injectEntry, 300);
})();
