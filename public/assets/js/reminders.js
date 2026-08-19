(() => {
  let loading = false;

  function esc(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

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

  function formatDateTime(value) {
    if (!value) return 'Noch nie';
    try {
      return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function markup(data) {
    const days = Number(data.daysBefore || 14);
    return `
      <section class="account-section reminder-v13-section" data-reminder-v13>
        <div class="account-section-head">
          <div>
            <strong>E-Mail-Erinnerungen</strong>
            <small>QRPass erinnert automatisch an bald fällige und fällige Prüfungen oder Wartungen.</small>
          </div>
          <span class="reminder-v13-badge ${data.enabled ? 'is-on' : ''}">${data.enabled ? 'Aktiv' : 'Aus'}</span>
        </div>

        ${data.mailReady ? '' : `
          <div class="reminder-v13-warning">
            Der E-Mail-Versand ist serverseitig noch nicht eingerichtet. Die Einstellungen können vorbereitet, aber Erinnerungen noch nicht aktiviert werden.
          </div>`}

        <form class="reminder-v13-form" data-reminder-v13-form>
          <label class="reminder-v13-toggle">
            <input type="checkbox" name="enabled" ${data.enabled ? 'checked' : ''} ${data.mailReady ? '' : 'disabled'}>
            <span><strong>Erinnerungen aktivieren</strong><small>Automatische Prüfung an Werktagen am Morgen.</small></span>
          </label>

          <label class="auth-field reminder-v13-email">
            <span>Empfänger-E-Mail</span>
            <input type="email" name="recipientEmail" required value="${esc(data.recipientEmail || '')}" autocomplete="email" placeholder="instandhaltung@firma.de">
          </label>

          <label class="auth-field">
            <span>Vorwarnung</span>
            <select name="daysBefore">
              ${[7, 14, 30, 60].map(option => `<option value="${option}" ${days === option ? 'selected' : ''}>${option} Tage vorher</option>`).join('')}
            </select>
          </label>

          <div class="reminder-v13-types">
            <span>Erinnern an</span>
            <label><input type="checkbox" name="includeInspections" ${data.includeInspections ? 'checked' : ''}> Prüfungen</label>
            <label><input type="checkbox" name="includeMaintenance" ${data.includeMaintenance ? 'checked' : ''}> Wartungen</label>
          </div>

          <div class="reminder-v13-actions">
            <button type="submit" class="button button-primary">Einstellungen speichern</button>
            <button type="button" class="button" data-reminder-v13-action="test" ${data.mailReady ? '' : 'disabled'}>Testmail senden</button>
          </div>
          <div class="reminder-v13-message" data-reminder-v13-message hidden></div>
        </form>

        <div class="reminder-v13-meta">
          <span>Zuletzt geprüft: <strong>${esc(formatDateTime(data.lastCheckedAt))}</strong></span>
          <span>Zuletzt gesendet: <strong>${esc(formatDateTime(data.lastSentAt))}</strong>${data.lastSentAt ? ` · ${Number(data.lastSentCount || 0)} Termin(e)` : ''}</span>
        </div>
        <p class="reminder-v13-note">Pro Termin sendet QRPass höchstens eine Vorwarnung und eine weitere Erinnerung bei Fälligkeit. Es werden keine täglichen Wiederholungsmails verschickt.</p>
      </section>`;
  }

  function setMessage(text, error = false) {
    const box = document.querySelector('[data-reminder-v13-message]');
    if (!box) return;
    box.textContent = text;
    box.hidden = !text;
    box.classList.toggle('error', error);
  }

  async function inject() {
    const body = document.querySelector('.account-panel-body');
    if (!body || body.querySelector('[data-reminder-v13]') || loading) return;
    loading = true;
    try {
      const data = await request('/api/reminders/settings');
      if (!document.querySelector('.account-panel-body')) return;
      const currentBody = document.querySelector('.account-panel-body');
      if (currentBody.querySelector('[data-reminder-v13]')) return;

      const importSection = currentBody.querySelector('[data-import-v12]');
      const backup = [...currentBody.querySelectorAll('.account-section')].find(section =>
        section.querySelector('.account-section-head strong')?.textContent.trim() === 'Datensicherung'
      );
      const anchor = importSection || backup;
      if (anchor) anchor.insertAdjacentHTML('afterend', markup(data));
      else currentBody.insertAdjacentHTML('beforeend', markup(data));

      currentBody.querySelector('[data-reminder-v13-form]')?.addEventListener('submit', save);
    } catch (error) {
      console.error('QRPass reminder settings could not load', error);
    } finally {
      loading = false;
    }
  }

  function formValues() {
    const form = document.querySelector('[data-reminder-v13-form]');
    if (!form) return null;
    const data = new FormData(form);
    return {
      enabled: form.elements.enabled?.checked === true,
      recipientEmail: String(data.get('recipientEmail') || '').trim(),
      daysBefore: Number(data.get('daysBefore') || 14),
      includeInspections: form.elements.includeInspections?.checked === true,
      includeMaintenance: form.elements.includeMaintenance?.checked === true
    };
  }

  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const values = formValues();
    if (!values) return;
    if (!values.includeInspections && !values.includeMaintenance) {
      return setMessage('Bitte Prüfungen oder Wartungen auswählen.', true);
    }

    button.disabled = true;
    const old = button.textContent;
    button.textContent = 'Speichert …';
    setMessage('');
    try {
      await request('/api/reminders/settings', {
        method: 'PUT',
        body: JSON.stringify(values)
      });
      setMessage(values.enabled ? 'E-Mail-Erinnerungen sind aktiviert.' : 'Einstellungen gespeichert. Erinnerungen sind ausgeschaltet.');
      if (typeof toast === 'function') toast('E-Mail-Erinnerungen gespeichert');
      const badge = document.querySelector('.reminder-v13-badge');
      if (badge) {
        badge.textContent = values.enabled ? 'Aktiv' : 'Aus';
        badge.classList.toggle('is-on', values.enabled);
      }
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  async function sendTest(button) {
    const values = formValues();
    if (!values?.recipientEmail) return setMessage('Bitte zuerst eine Empfänger-E-Mail eintragen.', true);
    button.disabled = true;
    const old = button.textContent;
    button.textContent = 'Sendet …';
    setMessage('');
    try {
      await request('/api/reminders/test', {
        method: 'POST',
        body: JSON.stringify({ recipientEmail: values.recipientEmail })
      });
      setMessage(`Testmail wurde an ${values.recipientEmail} gesendet.`);
      if (typeof toast === 'function') toast('Testmail gesendet');
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-reminder-v13-action="test"]');
    if (button) sendTest(button);
  });

  const observer = new MutationObserver(() => setTimeout(inject, 0));
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('qrpass:auth', () => setTimeout(inject, 0));
  setTimeout(inject, 300);
})();
