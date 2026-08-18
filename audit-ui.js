(() => {
  function actorText(entry) {
    if (!entry?.actorLabel) return 'Nicht erfasst';
    return entry.actorRole === 'admin'
      ? `Admin · ${entry.actorLabel}`
      : entry.actorLabel;
  }

  function resolverText(entry) {
    if (!entry?.resolvedByLabel) return 'Nicht erfasst';
    return entry.resolvedByRole === 'admin'
      ? `Admin · ${entry.resolvedByLabel}`
      : entry.resolvedByLabel;
  }

  function actionLabel(entry) {
    if (entry.type === 'fault') return 'Gemeldet von';
    if (entry.type === 'maintenance') return 'Eingetragen von';
    return 'Erstellt von';
  }

  function addMeta(target, className, text) {
    if (!target || target.querySelector(`.${className}`)) return;
    const meta = document.createElement('small');
    meta.className = className;
    meta.textContent = text;
    target.append(meta);
  }

  function cleanMaintenanceForm() {
    const person = document.querySelector('#maintenance-form [name="person"]');
    person?.closest('.field')?.remove();
  }

  function enhanceHistory() {
    cleanMaintenanceForm();
    if (typeof currentMachineId !== 'function' || typeof getMachine !== 'function') return;
    const id = currentMachineId();
    if (!id) return;
    const machine = getMachine(id);
    if (!machine) return;

    const history = [...(machine.history || [])].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    const rows = [...document.querySelectorAll('.history-item')];

    rows.forEach((row, index) => {
      const entry = history[index];
      if (!entry) return;
      const content = row.querySelector('div');
      addMeta(content, 'audit-meta', `${actionLabel(entry)} ${actorText(entry)}`);

      if (entry.type === 'fault' && entry.resolved) {
        const resolvedAt = entry.resolvedAt && typeof fmtDateTime === 'function'
          ? ` · ${fmtDateTime(entry.resolvedAt)}`
          : '';
        addMeta(content, 'audit-resolved', `Erledigt von ${resolverText(entry)}${resolvedAt}`);
      }
    });

    const openFaultEntries = (machine.history || []).filter(entry => entry.type === 'fault' && !entry.resolved);
    const cards = [...document.querySelectorAll('.fault-card')];
    cards.forEach((card, index) => {
      const entry = openFaultEntries[index];
      if (!entry) return;
      addMeta(card, 'fault-audit', `Gemeldet von ${actorText(entry)}`);
    });
  }

  const observer = new MutationObserver(enhanceHistory);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => setTimeout(enhanceHistory, 0));
  document.addEventListener('qrpass:auth', () => setTimeout(enhanceHistory, 0));
  setTimeout(enhanceHistory, 300);
})();
