(() => {
  let archiveData = null;

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

  function formatDateTime(value) {
    if (!value) return '–';
    try {
      return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function archiveCount() {
    try {
      return typeof state !== 'undefined' ? Number(state.archiveCount || 0) : 0;
    } catch {
      return 0;
    }
  }

  function injectArchiveEntry() {
    if (!isAdmin()) return;
    const search = document.querySelector('#machine-search');
    const head = search?.closest('.page-head');
    if (!head || head.querySelector('[data-archive-action="open"]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-small archive-open-button';
    button.dataset.archiveAction = 'open';
    button.textContent = archiveCount() ? `Archiv (${archiveCount()})` : 'Archiv';
    head.append(button);
  }

  function injectMachineArchiveButton() {
    if (!isAdmin()) return;
    if (typeof currentMachineId !== 'function' || !currentMachineId()) return;

    const panel = document.querySelector('.detail-grid .panel');
    const actions = panel?.querySelector('.panel-head > div');
    if (!actions || actions.querySelector('[data-archive-action="archive-current"]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-small archive-machine-button';
    button.dataset.archiveAction = 'archive-current';
    button.textContent = 'Archivieren';
    actions.append(button);
  }

  function closeArchive() {
    document.querySelector('#archive-backdrop')?.remove();
    archiveData = null;
  }

  function actorText(machine) {
    if (!machine.archivedByLabel) return '';
    return machine.archivedByRole === 'admin'
      ? `Admin · ${machine.archivedByLabel}`
      : machine.archivedByLabel;
  }

  function archiveMarkup(data) {
    const machines = Array.isArray(data.machines) ? data.machines : [];
    return `
      <div class="archive-backdrop" id="archive-backdrop">
        <section class="archive-panel" role="dialog" aria-modal="true" aria-labelledby="archive-title">
          <header class="archive-panel-head">
            <div><small>Admin</small><h2 id="archive-title">Archivierte Maschinen</h2></div>
            <button type="button" class="archive-close" data-archive-action="close" aria-label="Schließen">×</button>
          </header>
          <div class="archive-panel-body">
            ${machines.length ? `
              <div class="archive-list">
                ${machines.map(machine => `
                  <article class="archive-row">
                    <div class="archive-row-main">
                      <strong>${esc(machine.name)}</strong>
                      <small>${esc(machine.assetId || 'Keine Anlagennummer')} · ${esc(machine.area || 'Kein Bereich')}</small>
                      <small>Archiviert ${esc(formatDateTime(machine.archivedAt))}${actorText(machine) ? ` · von ${esc(actorText(machine))}` : ''}</small>
                    </div>
                    <div class="archive-row-actions">
                      <button type="button" class="button button-small" data-archive-action="restore" data-id="${esc(machine.id)}">Wiederherstellen</button>
                      <button type="button" class="button button-small archive-delete" data-archive-action="delete" data-id="${esc(machine.id)}" data-name="${esc(machine.name)}">Endgültig löschen</button>
                    </div>
                  </article>`).join('')}
              </div>` : `
              <div class="archive-empty">
                <strong>Archiv ist leer</strong>
                <span>Archivierte Maschinen erscheinen hier und können wiederhergestellt werden.</span>
              </div>`}
          </div>
        </section>
      </div>`;
  }

  async function openArchive() {
    if (!isAdmin()) return;
    try {
      archiveData = await request('/api/archive');
      document.querySelector('#archive-backdrop')?.remove();
      document.body.insertAdjacentHTML('beforeend', archiveMarkup(archiveData));
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function archiveCurrent() {
    if (!isAdmin() || typeof currentMachineId !== 'function' || typeof getMachine !== 'function') return;
    const id = currentMachineId();
    const machine = id ? getMachine(id) : null;
    if (!machine) return;

    if (!window.confirm(`${machine.name} archivieren?\n\nDie Maschine verschwindet aus der normalen Übersicht, kann aber jederzeit wiederhergestellt werden.`)) return;

    try {
      await request(`/api/machines/${encodeURIComponent(machine.id)}/archive`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true })
      });
      if (typeof loadRemoteState === 'function') await loadRemoteState();
      location.hash = '';
      if (typeof render === 'function') render();
      if (typeof toast === 'function') toast('Maschine archiviert');
    } catch (error) {
      if (typeof toast === 'function') toast(error.message);
      else window.alert(error.message);
    }
  }

  async function restoreMachine(button) {
    button.disabled = true;
    try {
      await request(`/api/machines/${encodeURIComponent(button.dataset.id)}/archive`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: false })
      });
      if (typeof loadRemoteState === 'function') await loadRemoteState();
      if (typeof render === 'function') render();
      await openArchive();
      if (typeof toast === 'function') toast('Maschine wiederhergestellt');
    } catch (error) {
      button.disabled = false;
      window.alert(error.message);
    }
  }

  async function deleteMachine(button) {
    const name = button.dataset.name || 'Maschine';
    const confirmed = window.confirm(
      `${name} ENDGÜLTIG löschen?\n\nDabei werden auch Störungen, Wartungen und Notizen dieser Maschine gelöscht. Das kann nicht rückgängig gemacht werden.`
    );
    if (!confirmed) return;

    button.disabled = true;
    try {
      await request(`/api/machines/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
      if (typeof loadRemoteState === 'function') await loadRemoteState();
      if (typeof render === 'function') render();
      await openArchive();
      if (typeof toast === 'function') toast('Maschine endgültig gelöscht');
    } catch (error) {
      button.disabled = false;
      window.alert(error.message);
    }
  }

  function enhanceQrLabel() {
    const label = document.querySelector('.qr-label');
    if (!label || label.dataset.v08 === '1') return;

    let machine = null;
    let company = null;
    try {
      machine = typeof currentMachineId === 'function' && typeof getMachine === 'function'
        ? getMachine(currentMachineId())
        : null;
      company = typeof state !== 'undefined' ? state.company : null;
    } catch {
      machine = null;
      company = null;
    }
    if (!machine) return;

    label.dataset.v08 = '1';
    label.classList.add('qrpass-print-label');

    const brand = document.createElement('div');
    brand.className = 'qr-label-brand';
    const hasLogo = Boolean(company?.logoDataUrl);

    if (hasLogo) {
      brand.classList.add('has-logo');
      const img = document.createElement('img');
      img.src = company.logoDataUrl;
      img.alt = company.companyName ? `${company.companyName} Logo` : 'Firmenlogo';
      brand.append(img);
    } else {
      const brandCopy = document.createElement('div');
      const firm = document.createElement('strong');
      firm.textContent = company?.companyName || 'QRPass';
      const product = document.createElement('small');
      product.textContent = 'Betriebsmittelbuch';
      brandCopy.append(firm, product);
      brand.append(brandCopy);
    }

    label.prepend(brand);

    const instruction = document.createElement('small');
    instruction.className = 'qr-scan-instruction';
    instruction.textContent = 'Mit QRPass scannen';
    label.append(instruction);
  }

  function enhance() {
    injectArchiveEntry();
    injectMachineArchiveButton();
    enhanceQrLabel();
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-archive-action]');
    if (!button) return;
    const action = button.dataset.archiveAction;
    if (action === 'open') openArchive();
    if (action === 'close') closeArchive();
    if (action === 'archive-current') archiveCurrent();
    if (action === 'restore') restoreMachine(button);
    if (action === 'delete') deleteMachine(button);
  });

  document.addEventListener('qrpass:auth', () => setTimeout(enhance, 0));
  window.addEventListener('hashchange', () => setTimeout(enhance, 0));
  const observer = new MutationObserver(enhance);
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(enhance, 350);
})();
