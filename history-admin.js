(() => {
  function isAdmin() {
    return document.body.dataset.role === 'admin';
  }

  function sortedHistory(machine) {
    return [...(machine?.history || [])].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  function typeLabel(type) {
    if (type === 'maintenance') return 'Wartung';
    if (type === 'inspection') return 'Prüfung';
    return 'Störung';
  }

  function enhanceHistoryDelete() {
    if (!isAdmin()) return;
    if (typeof currentMachineId !== 'function' || typeof getMachine !== 'function') return;

    const machineId = currentMachineId();
    if (!machineId) return;
    const machine = getMachine(machineId);
    if (!machine) return;

    const history = sortedHistory(machine);
    const rows = [...document.querySelectorAll('.history-item')];

    rows.forEach((row, index) => {
      const entry = history[index];
      if (!entry || !['fault', 'maintenance', 'inspection'].includes(entry.type)) return;
      if (row.querySelector('[data-history-admin="delete"]')) return;

      const content = row.querySelector('div');
      if (!content) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-delete-button';
      button.dataset.historyAdmin = 'delete';
      button.dataset.machine = machine.id;
      button.dataset.entry = entry.id;
      button.dataset.type = entry.type;
      button.dataset.title = entry.title || typeLabel(entry.type);
      button.textContent = 'Löschen';
      content.append(button);
    });
  }

  async function deleteEntry(button) {
    const type = button.dataset.type;
    const label = typeLabel(type);
    const title = button.dataset.title || label;
    const extra = type === 'maintenance'
      ? '\n\nDie letzte Wartung und der nächste Wartungstermin werden danach automatisch neu berechnet.'
      : type === 'inspection'
        ? '\n\nDie letzte und nächste Prüfung werden danach automatisch aus den verbleibenden Prüfungseinträgen neu berechnet.'
        : '';

    const confirmed = window.confirm(
      `${label} „${title}“ wirklich löschen?\n\nDer Eintrag wird dauerhaft aus dem Verlauf entfernt.${extra}`
    );
    if (!confirmed) return;

    button.disabled = true;
    button.textContent = 'Wird gelöscht …';

    try {
      const response = await fetch(
        `/api/machines/${encodeURIComponent(button.dataset.machine)}/entries/${encodeURIComponent(button.dataset.entry)}`,
        { method: 'DELETE', cache: 'no-store' }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Eintrag konnte nicht gelöscht werden.');

      if (typeof loadRemoteState === 'function') await loadRemoteState();
      if (typeof render === 'function') render();
      if (typeof toast === 'function') toast(`${label} gelöscht`);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Löschen';
      if (typeof toast === 'function') toast(error.message);
      else window.alert(error.message);
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-history-admin="delete"]');
    if (button) deleteEntry(button);
  });

  document.addEventListener('qrpass:auth', () => setTimeout(enhanceHistoryDelete, 0));
  window.addEventListener('hashchange', () => setTimeout(enhanceHistoryDelete, 0));
  const observer = new MutationObserver(enhanceHistoryDelete);
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(enhanceHistoryDelete, 300);
})();
