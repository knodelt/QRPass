(() => {
  const ASSET_TYPES = {
    machine: 'Maschine',
    inspection_system: 'Prüfpflichtige Anlage',
    ladder: 'Leiter / Tritt',
    forklift: 'Stapler / Flurförderzeug',
    crane: 'Kran',
    lifting_equipment: 'Hebezeug',
    lifting_accessory: 'Anschlagmittel',
    other: 'Sonstiges Betriebsmittel'
  };

  const KIND_LABELS = {
    recurring: 'Wiederkehrende Prüfung',
    initial: 'Erstprüfung',
    extraordinary: 'Außerordentliche Prüfung',
    other: 'Sonstige Prüfung'
  };

  const RESULT_LABELS = {
    passed: 'Ohne Mangel',
    defect: 'Mangel festgestellt',
    failed: 'Außer Betrieb'
  };

  function machines() {
    try { return Array.isArray(state?.machines) ? state.machines : []; }
    catch { return []; }
  }

  function assetTypeLabel(machine) {
    return ASSET_TYPES[machine?.assetType || 'machine'] || ASSET_TYPES.other;
  }

  function localDaysUntil(date) {
    if (!date) return null;
    try {
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      const target = new Date(`${date}T12:00:00`);
      return Math.round((target - today) / 86400000);
    } catch { return null; }
  }

  function formatDate(date) {
    if (!date) return '–';
    try {
      return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      }).format(new Date(`${date}T12:00:00`));
    } catch { return date; }
  }

  function latestInspection(machine) {
    return [...(machine?.history || [])]
      .filter(entry => entry.type === 'inspection')
      .sort((a, b) => {
        const ad = a.inspectionDate || String(a.createdAt || '').slice(0, 10);
        const bd = b.inspectionDate || String(b.createdAt || '').slice(0, 10);
        return bd.localeCompare(ad) || new Date(b.createdAt) - new Date(a.createdAt);
      })[0] || null;
  }

  function inspectionStatus(machine) {
    if (!machine?.inspectionEnabled) return null;
    const latest = latestInspection(machine);
    if (latest?.inspectionResult === 'failed') return { key: 'danger', label: 'Außer Betrieb' };
    if (latest?.inspectionResult === 'defect') return { key: 'warn', label: 'Mangel bei Prüfung' };
    if (!machine.nextInspection) return { key: 'warn', label: 'Prüftermin fehlt' };
    const days = localDaysUntil(machine.nextInspection);
    if (days < 0) return { key: 'danger', label: 'Prüfung überfällig' };
    if (days <= 30) return { key: 'warn', label: 'Prüfung bald fällig' };
    return { key: 'ok', label: 'Prüfung gültig' };
  }

  function combinedStatus(machine) {
    try {
      if (typeof openFaults === 'function' && openFaults(machine).length) {
        return { key: 'danger', label: 'Störung offen' };
      }
    } catch {}

    const inspection = inspectionStatus(machine);
    if (inspection && inspection.key !== 'ok') return inspection;

    if ((machine?.assetType || 'machine') === 'machine') {
      try { if (typeof machineStatus === 'function') return machineStatus(machine); }
      catch {}
    }

    return inspection || { key: 'ok', label: 'In Ordnung' };
  }

  function isInspectionDue(machine) {
    if (!machine?.inspectionEnabled) return false;
    if (!machine.nextInspection) return true;
    return localDaysUntil(machine.nextInspection) <= 30;
  }

  function updateStatusElement(element, status) {
    if (!element || !status) return;
    element.classList.remove('status-ok', 'status-warn', 'status-danger');
    element.classList.add(`status-${status.key}`);
    element.textContent = status.label;
  }

  function enhanceDashboard() {
    const pageHead = document.querySelector('.page-head');
    if (!pageHead) return;

    const heading = pageHead.querySelector('h1');
    if (heading) heading.textContent = 'Betriebsmittel';
    const search = pageHead.querySelector('#machine-search');
    if (search) search.placeholder = 'Betriebsmittel, Nummer oder Bereich suchen';

    const all = machines();
    const stats = document.querySelector('.stats');
    if (stats) {
      const cards = [...stats.querySelectorAll('.stat')];
      if (cards[0]?.querySelector('span')) cards[0].querySelector('span').textContent = 'Betriebsmittel';

      if (cards[2]) {
        const maintenanceDue = all.filter(machine => {
          if ((machine.assetType || 'machine') !== 'machine') return false;
          try {
            const date = typeof machineNextDue === 'function' ? machineNextDue(machine) : null;
            return date && localDaysUntil(date) <= 14;
          } catch { return false; }
        }).length;
        cards[2].querySelector('span').textContent = 'Wartung fällig';
        cards[2].querySelector('strong').textContent = maintenanceDue;
      }

      let inspectionCard = stats.querySelector('.inspection-stat');
      if (!inspectionCard) {
        inspectionCard = document.createElement('article');
        inspectionCard.className = 'stat inspection-stat';
        inspectionCard.innerHTML = '<span>Prüfungen fällig</span><strong>0</strong><small></small>';
        stats.append(inspectionCard);
      }
      const due = all.filter(isInspectionDue).length;
      const overdue = all.filter(machine => machine.inspectionEnabled && machine.nextInspection && localDaysUntil(machine.nextInspection) < 0).length;
      inspectionCard.querySelector('strong').textContent = due;
      inspectionCard.querySelector('small').textContent = overdue ? `${overdue} überfällig` : '';
    }

    document.querySelectorAll('.machine-row').forEach(row => {
      const open = row.querySelector('[data-action="open-machine"]');
      const machine = all.find(item => item.id === open?.dataset.id);
      if (!machine) return;

      const main = row.querySelector('.machine-main');
      const sub = main?.querySelector('small');
      if (sub) {
        sub.textContent = `${assetTypeLabel(machine)} · ${machine.assetId || 'Keine Anlagennummer'} · ${machine.area || 'Kein Bereich'}`;
      }

      let tag = main?.querySelector('.inspection-list-tag');
      if (machine.inspectionEnabled) {
        if (!tag) {
          tag = document.createElement('span');
          tag.className = 'inspection-list-tag';
          main.append(tag);
        }
        tag.textContent = machine.nextInspection
          ? `Nächste Prüfung ${formatDate(machine.nextInspection)}`
          : 'Prüftermin fehlt';
      } else {
        tag?.remove();
      }

      const cells = row.querySelectorAll('.machine-cell');
      if ((machine.assetType || 'machine') !== 'machine' && cells[0]) {
        const label = cells[0].querySelector('small');
        const value = cells[0].querySelector('strong');
        if (label) label.textContent = 'Nächste Prüfung';
        if (value) value.textContent = machine.inspectionEnabled ? formatDate(machine.nextInspection) : 'Nicht aktiviert';
      }

      updateStatusElement(row.querySelector('.status'), combinedStatus(machine));
    });

    const empty = document.querySelector('#machine-list .empty');
    if (empty) {
      const strong = empty.querySelector('strong');
      if (strong) strong.textContent = 'Noch keine Betriebsmittel';
      const add = empty.querySelector('[data-action="add-machine"]');
      if (add) add.textContent = 'Betriebsmittel anlegen';
    }
  }

  function enhanceDetail() {
    if (typeof currentMachineId !== 'function' || typeof getMachine !== 'function') return;
    const id = currentMachineId();
    if (!id) return;
    const machine = getMachine(id);
    if (!machine) return;

    const eyebrow = document.querySelector('.detail-head .eyebrow');
    if (eyebrow) eyebrow.textContent = `${assetTypeLabel(machine)} · ${machine.assetId || 'ohne Nummer'}`;
    updateStatusElement(document.querySelector('.detail-head .status'), combinedStatus(machine));

    const actions = document.querySelector('.detail-actions');
    if (actions && !actions.querySelector('[data-inspection-action="add"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button inspection-entry-button';
      button.dataset.inspectionAction = 'add';
      button.dataset.id = machine.id;
      button.textContent = 'Prüfung eintragen';
      actions.append(button);
    }

    const panelHead = document.querySelector('.detail-grid .panel .panel-head h2');
    if (panelHead) panelHead.textContent = 'Betriebsmitteldaten';

    const grid = document.querySelector('.detail-grid .panel .info-grid');
    if (grid) {
      [...grid.querySelectorAll('.info-box')].forEach(box => {
        const label = box.querySelector('span')?.textContent;
        if (label === 'Letzte Wartung' || label === 'Nächste Wartung') {
          box.hidden = (machine.assetType || 'machine') !== 'machine';
        }
      });

      if (!grid.querySelector('[data-inspection-info="type"]')) {
        const box = document.createElement('div');
        box.className = 'info-box inspection-info-box';
        box.dataset.inspectionInfo = 'type';
        grid.append(box);
      }
      const typeBox = grid.querySelector('[data-inspection-info="type"]');
      typeBox.innerHTML = `<span>Betriebsmittelart</span><strong>${assetTypeLabel(machine)}</strong>`;

      if (!grid.querySelector('[data-inspection-info="status"]')) {
        const box = document.createElement('div');
        box.className = 'info-box inspection-info-box';
        box.dataset.inspectionInfo = 'status';
        grid.append(box);
      }
      const statusBox = grid.querySelector('[data-inspection-info="status"]');
      statusBox.innerHTML = `<span>Prüfungen</span><strong>${machine.inspectionEnabled ? inspectionStatus(machine)?.label || 'Aktiv' : 'Nicht aktiviert'}</strong>`;

      ['last', 'next'].forEach(kind => {
        let box = grid.querySelector(`[data-inspection-info="${kind}"]`);
        if (machine.inspectionEnabled) {
          if (!box) {
            box = document.createElement('div');
            box.className = 'info-box inspection-info-box';
            box.dataset.inspectionInfo = kind;
            grid.append(box);
          }
          box.innerHTML = kind === 'last'
            ? `<span>Letzte Prüfung</span><strong>${formatDate(machine.lastInspection)}</strong>`
            : `<span>Nächste Prüfung</span><strong>${formatDate(machine.nextInspection)}</strong>`;
        } else {
          box?.remove();
        }
      });
    }

    const latest = latestInspection(machine);
    let alert = document.querySelector('.inspection-result-alert');
    if (latest && ['defect', 'failed'].includes(latest.inspectionResult)) {
      if (!alert) {
        alert = document.createElement('div');
        alert.className = 'inspection-result-alert';
        grid?.insertAdjacentElement('afterend', alert);
      }
      alert.dataset.result = latest.inspectionResult;
      alert.innerHTML = `<strong>Letzte Prüfung: ${RESULT_LABELS[latest.inspectionResult]}</strong><span>${latest.inspectionDate ? formatDate(latest.inspectionDate) : ''}${latest.inspectorName ? ` · Prüfer: ${latest.inspectorName}` : ''}</span>`;
    } else {
      alert?.remove();
    }

    enhanceInspectionHistory(machine);
  }

  function enhanceInspectionHistory(machine) {
    const history = [...(machine.history || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const rows = [...document.querySelectorAll('.history-item')];
    rows.forEach((row, index) => {
      const entry = history[index];
      if (entry?.type !== 'inspection') return;
      row.classList.add('inspection-history-item');
      const content = row.querySelector('div');
      if (!content || content.querySelector('.inspection-history-meta')) return;
      const meta = document.createElement('small');
      meta.className = 'inspection-history-meta';
      const parts = [
        KIND_LABELS[entry.inspectionKind] || 'Prüfung',
        entry.inspectorName ? `Prüfer: ${entry.inspectorName}` : '',
        entry.inspectionDate ? `am ${formatDate(entry.inspectionDate)}` : '',
        entry.nextInspection ? `nächste ${formatDate(entry.nextInspection)}` : ''
      ].filter(Boolean);
      meta.textContent = parts.join(' · ');
      content.append(meta);
    });
  }

  function machineFromOpenForm() {
    const eyebrow = document.querySelector('#modal-eyebrow')?.textContent?.toLowerCase() || '';
    if (!eyebrow.includes('bearbeiten')) return null;
    try {
      return typeof currentMachineId === 'function' && typeof getMachine === 'function'
        ? getMachine(currentMachineId())
        : null;
    } catch { return null; }
  }

  function enhanceMachineForm() {
    const form = document.querySelector('#machine-form');
    if (!form || form.dataset.inspectionV11 === '1') return;
    form.dataset.inspectionV11 = '1';

    const machine = machineFromOpenForm() || {};
    const firstLabel = form.querySelector('input[name="name"]')?.closest('.field')?.querySelector('label');
    if (firstLabel) firstLabel.textContent = 'Bezeichnung des Betriebsmittels *';
    const nameInput = form.querySelector('input[name="name"]');
    if (nameInput) nameInput.placeholder = 'z. B. Presse 04 oder Leiter L-014';

    const title = document.querySelector('#modal-title');
    const eyebrow = document.querySelector('#modal-eyebrow');
    if (title?.textContent === 'Maschine anlegen') title.textContent = 'Betriebsmittel anlegen';
    if (eyebrow?.textContent === 'Neue Maschine') eyebrow.textContent = 'Neues Betriebsmittel';
    if (eyebrow?.textContent === 'Maschine bearbeiten') eyebrow.textContent = 'Betriebsmittel bearbeiten';

    const notes = form.querySelector('textarea[name="notes"]')?.closest('.field');
    if (!notes) return;

    const typeOptions = Object.entries(ASSET_TYPES).map(([value, label]) =>
      `<option value="${value}" ${(machine.assetType || 'machine') === value ? 'selected' : ''}>${label}</option>`
    ).join('');
    const enabled = Boolean(machine.inspectionEnabled);

    notes.insertAdjacentHTML('beforebegin', `
      <div class="field full inspection-config-head">
        <label>Betriebsmittelart</label>
        <select name="assetType">${typeOptions}</select>
      </div>
      <div class="field">
        <label>Prüfungen verwalten?</label>
        <select name="inspectionEnabled" data-inspection-config-toggle>
          <option value="0" ${!enabled ? 'selected' : ''}>Nein</option>
          <option value="1" ${enabled ? 'selected' : ''}>Ja</option>
        </select>
      </div>
      <div class="field inspection-config-field">
        <label>Prüfintervall in Tagen</label>
        <input name="inspectionInterval" type="number" min="1" value="${machine.inspectionInterval || ''}" placeholder="Optional">
      </div>
      <div class="field inspection-config-field">
        <label>Letzte Prüfung</label>
        <input name="lastInspection" type="date" value="${machine.lastInspection || ''}">
      </div>
      <div class="field inspection-config-field">
        <label>Nächste Prüfung</label>
        <input name="nextInspection" type="date" value="${machine.nextInspection || ''}">
      </div>
      <div class="field full inspection-config-hint">
        <small>QRPass gibt keine Prüffrist vor. Tragen Sie nur die in Ihrem Betrieb festgelegte Prüffrist bzw. den festgelegten nächsten Termin ein.</small>
      </div>`);

    const toggle = form.querySelector('[data-inspection-config-toggle]');
    const updateVisibility = () => {
      const show = toggle?.value === '1';
      form.querySelectorAll('.inspection-config-field,.inspection-config-hint').forEach(field => {
        field.hidden = !show;
      });
    };
    toggle?.addEventListener('change', updateVisibility);
    updateVisibility();
  }

  function today() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function addDaysLocal(date, days) {
    if (!date || !days) return '';
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + Number(days));
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function createId() {
    try { if (typeof uid === 'function') return uid('inspection'); } catch {}
    return `inspection_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function showInspectionForm(machine) {
    if (!machine || typeof openModal !== 'function') return;
    const date = today();
    const next = machine.inspectionInterval ? addDaysLocal(date, machine.inspectionInterval) : '';

    openModal({
      eyebrow: machine.assetId || assetTypeLabel(machine),
      title: `Prüfung · ${machine.name}`,
      body: `
        <form id="inspection-form">
          <div class="inspection-form-note">QRPass gibt keine Prüffrist vor. Der nächste Prüftermin muss entsprechend der betrieblich festgelegten Frist eingetragen werden.</div>
          <div class="form-grid">
            <div class="field">
              <label>Prüfart *</label>
              <select name="inspectionKind" required>
                <option value="recurring">Wiederkehrende Prüfung</option>
                <option value="initial">Erstprüfung</option>
                <option value="extraordinary">Außerordentliche Prüfung</option>
                <option value="other">Sonstige Prüfung</option>
              </select>
            </div>
            <div class="field"><label>Prüfdatum *</label><input name="date" type="date" required value="${date}"></div>
            <div class="field full"><label>Prüfer / befähigte Person *</label><input name="inspector" required maxlength="160" placeholder="Name des Prüfers"></div>
            <div class="field">
              <label>Ergebnis *</label>
              <select name="result" required>
                <option value="passed">Ohne Mangel</option>
                <option value="defect">Mangel festgestellt</option>
                <option value="failed">Außer Betrieb</option>
              </select>
            </div>
            <div class="field"><label>Nächster Prüftermin *</label><input name="nextInspection" type="date" required value="${next}"></div>
            <div class="field full"><label>Bemerkung</label><textarea name="text" placeholder="Feststellungen, Maßnahmen oder Hinweise"></textarea></div>
          </div>
          <div class="form-actions">
            <button type="button" class="button" data-action="close-modal">Abbrechen</button>
            <button class="button button-primary" type="submit">Prüfung speichern</button>
          </div>
        </form>`,
      onReady: root => {
        const form = root.querySelector('#inspection-form');
        const dateInput = form.querySelector('[name="date"]');
        const nextInput = form.querySelector('[name="nextInspection"]');
        dateInput?.addEventListener('change', () => {
          if (machine.inspectionInterval) nextInput.value = addDaysLocal(dateInput.value, machine.inspectionInterval);
        });

        form.addEventListener('submit', async event => {
          event.preventDefault();
          const submit = form.querySelector('[type="submit"]');
          submit.disabled = true;
          submit.textContent = 'Speichert …';
          try {
            const data = Object.fromEntries(new FormData(form).entries());
            const response = await fetch(`/api/machines/${encodeURIComponent(machine.id)}/entries`, {
              method: 'POST',
              cache: 'no-store',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                id: createId(),
                type: 'inspection',
                inspectionKind: data.inspectionKind,
                date: data.date,
                inspector: data.inspector,
                result: data.result,
                nextInspection: data.nextInspection,
                text: data.text,
                createdAt: new Date(`${data.date}T12:00:00`).toISOString()
              })
            });
            const result = await response.json().catch(() => null);
            if (!response.ok) throw new Error(result?.error || 'Prüfung konnte nicht gespeichert werden.');

            if (typeof loadRemoteState === 'function') await loadRemoteState();
            if (typeof closeModal === 'function') closeModal();
            if (typeof toast === 'function') toast('Prüfung gespeichert');
            if (typeof render === 'function') render();
          } catch (error) {
            submit.disabled = false;
            submit.textContent = 'Prüfung speichern';
            if (typeof toast === 'function') toast(error.message);
            else window.alert(error.message);
          }
        });
      }
    });
  }

  function enhanceGlobal() {
    const add = document.querySelector('.top-actions [data-action="add-machine"]');
    if (add) add.textContent = '+ Betriebsmittel';
    enhanceDashboard();
    enhanceDetail();
    enhanceMachineForm();
  }

  let scheduled = false;
  let observer = null;
  function watch() {
    observer?.observe(document.body, { childList: true, subtree: true });
  }
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      observer?.disconnect();
      try {
        enhanceGlobal();
      } finally {
        watch();
      }
    });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-inspection-action="add"]');
    if (!button) return;
    try {
      const machine = typeof getMachine === 'function' ? getMachine(button.dataset.id) : null;
      showInspectionForm(machine);
    } catch {}
  });

  document.addEventListener('qrpass:auth', scheduleEnhance);
  window.addEventListener('hashchange', scheduleEnhance);
  observer = new MutationObserver(scheduleEnhance);
  watch();
  setTimeout(scheduleEnhance, 250);
})();
