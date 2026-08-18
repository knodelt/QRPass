(() => {
  let employeeData = null;

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

  function injectEntry() {
    if (!isAdmin()) return;
    const form = document.querySelector('#company-setup-form');
    const actions = form?.querySelector('.company-setup-actions');
    if (!form || !actions || form.querySelector('.employee-admin-entry')) return;
    const block = document.createElement('div');
    block.className = 'employee-admin-entry';
    block.innerHTML = `
      <div>
        <strong>Mitarbeiter</strong>
        <small>Firmen-Code, PIN-Zugänge und aktive Mitarbeiter verwalten.</small>
      </div>
      <button type="button" class="button" data-employee-action="open">Mitarbeiter verwalten</button>`;
    actions.before(block);
  }

  function closeManager() {
    document.querySelector('#employee-backdrop')?.remove();
    employeeData = null;
  }

  function managerMarkup(data) {
    const employees = Array.isArray(data.employees) ? data.employees : [];
    return `
      <div class="employee-backdrop" id="employee-backdrop">
        <section class="employee-panel" role="dialog" aria-modal="true" aria-labelledby="employee-title">
          <header class="employee-panel-head">
            <div><small>Firma</small><h2 id="employee-title">Mitarbeiter</h2></div>
            <button type="button" class="employee-close" data-employee-action="close" aria-label="Schließen">×</button>
          </header>
          <div class="employee-panel-body">
            <div class="employee-code-box">
              <div><span>Firmen-Code für die Anmeldung</span><strong>${esc(data.companyCode || '')}</strong></div>
              <button type="button" class="button button-small" data-employee-action="copy-code" data-code="${esc(data.companyCode || '')}">Code kopieren</button>
            </div>

            <form id="employee-form" class="employee-form">
              <label class="auth-field">
                <span>Name</span>
                <input name="name" required maxlength="120" placeholder="z. B. Max Mustermann">
              </label>
              <label class="auth-field">
                <span>6-stellige PIN</span>
                <input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" required minlength="6" maxlength="6" placeholder="000000">
              </label>
              <button class="button button-primary" type="submit">Anlegen</button>
              <div id="employee-form-error" class="employee-form-error" hidden></div>
            </form>

            <div class="employee-list">
              ${employees.length ? employees.map(employee => `
                <article class="employee-row">
                  <div class="employee-row-main">
                    <strong>${esc(employee.name)}</strong>
                    <small>Mitarbeiterzugang</small>
                  </div>
                  <span class="employee-status ${employee.active ? 'active' : 'inactive'}">${employee.active ? 'Aktiv' : 'Deaktiviert'}</span>
                  <div class="employee-row-actions">
                    <button type="button" class="button" data-employee-action="toggle" data-id="${esc(employee.id)}" data-active="${employee.active ? '1' : '0'}">${employee.active ? 'Deaktivieren' : 'Aktivieren'}</button>
                    <button type="button" class="button" data-employee-action="delete" data-id="${esc(employee.id)}" data-name="${esc(employee.name)}">Löschen</button>
                  </div>
                </article>`).join('') : '<div class="employee-empty">Noch keine Mitarbeiter angelegt.</div>'}
            </div>

            <p class="employee-note">Die PIN wird nach dem Anlegen nicht angezeigt. Jeder Mitarbeiter benötigt den Firmen-Code und seine persönliche PIN.</p>
          </div>
        </section>
      </div>`;
  }

  function bindPinInput() {
    const pin = document.querySelector('#employee-form input[name="pin"]');
    pin?.addEventListener('input', () => {
      pin.value = pin.value.replace(/\D/g, '').slice(0, 6);
    });
  }

  async function openManager() {
    if (!isAdmin()) return;
    try {
      employeeData = await request('/api/employees');
      document.querySelector('#employee-backdrop')?.remove();
      document.body.insertAdjacentHTML('beforeend', managerMarkup(employeeData));
      const form = document.querySelector('#employee-form');
      form?.addEventListener('submit', createEmployee);
      bindPinInput();
    } catch (error) {
      window.alert(error.message);
    }
  }

  function setFormError(text) {
    const error = document.querySelector('#employee-form-error');
    if (!error) return;
    error.textContent = text;
    error.hidden = !text;
  }

  async function createEmployee(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    const name = String(values.name || '').trim();
    const pin = String(values.pin || '');
    if (!name) return setFormError('Bitte den Namen eintragen.');
    if (!/^\d{6}$/.test(pin)) return setFormError('Die PIN muss genau 6 Ziffern haben.');
    if (!employeeData?.pinSalt || !window.QRPassAuth?.deriveVerifier) return setFormError('Sichere PIN-Verarbeitung ist nicht verfügbar.');

    submit.disabled = true;
    submit.textContent = 'Wird angelegt …';
    setFormError('');
    try {
      const pinVerifier = await window.QRPassAuth.deriveVerifier(pin, employeeData.pinSalt);
      await request('/api/employees', {
        method: 'POST',
        body: JSON.stringify({ name, pinVerifier })
      });
      await openManager();
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Anlegen';
      setFormError(error.message);
    }
  }

  async function toggleEmployee(button) {
    button.disabled = true;
    try {
      await request(`/api/employees/${encodeURIComponent(button.dataset.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: button.dataset.active !== '1' })
      });
      await openManager();
    } catch (error) {
      button.disabled = false;
      window.alert(error.message);
    }
  }

  async function deleteEmployee(button) {
    const name = button.dataset.name || 'Mitarbeiter';
    if (!window.confirm(`${name} wirklich löschen?`)) return;
    button.disabled = true;
    try {
      await request(`/api/employees/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
      await openManager();
    } catch (error) {
      button.disabled = false;
      window.alert(error.message);
    }
  }

  async function copyCode(button) {
    const code = button.dataset.code || '';
    try {
      await navigator.clipboard.writeText(code);
      const old = button.textContent;
      button.textContent = 'Kopiert';
      setTimeout(() => { button.textContent = old; }, 1200);
    } catch {
      window.prompt('Firmen-Code kopieren:', code);
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-employee-action]');
    if (!button) return;
    const action = button.dataset.employeeAction;
    if (action === 'open') openManager();
    if (action === 'close') closeManager();
    if (action === 'copy-code') copyCode(button);
    if (action === 'toggle') toggleEmployee(button);
    if (action === 'delete') deleteEmployee(button);
  });

  document.addEventListener('qrpass:auth', injectEntry);
  const observer = new MutationObserver(injectEntry);
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(injectEntry, 300);
})();
