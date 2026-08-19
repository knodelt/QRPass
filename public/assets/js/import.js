(() => {
  const MAX_FILE_BYTES = 1024 * 1024;
  const MAX_ROWS = 200;
  let currentRows = [];
  let previewData = null;

  const TYPE_MAP = new Map([
    ['maschine', 'machine'], ['machine', 'machine'],
    ['pruefpflichtige anlage', 'inspection_system'], ['prüfpflichtige anlage', 'inspection_system'], ['inspection_system', 'inspection_system'],
    ['leiter / tritt', 'ladder'], ['leiter/tritt', 'ladder'], ['leiter', 'ladder'], ['tritt', 'ladder'], ['ladder', 'ladder'],
    ['stapler / flurfoerderzeug', 'forklift'], ['stapler / flurförderzeug', 'forklift'], ['stapler', 'forklift'], ['flurfoerderzeug', 'forklift'], ['flurförderzeug', 'forklift'], ['forklift', 'forklift'],
    ['kran', 'crane'], ['crane', 'crane'],
    ['hebezeug', 'lifting_equipment'], ['lifting_equipment', 'lifting_equipment'],
    ['anschlagmittel', 'lifting_accessory'], ['lifting_accessory', 'lifting_accessory'],
    ['sonstiges betriebsmittel', 'other'], ['sonstiges', 'other'], ['other', 'other']
  ]);

  const TYPE_LABELS = {
    machine: 'Maschine',
    inspection_system: 'Prüfpflichtige Anlage',
    ladder: 'Leiter / Tritt',
    forklift: 'Stapler / Flurförderzeug',
    crane: 'Kran',
    lifting_equipment: 'Hebezeug',
    lifting_accessory: 'Anschlagmittel',
    other: 'Sonstiges Betriebsmittel'
  };

  function esc(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function normalize(value = '') {
    return String(value)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function headerKey(header) {
    const key = normalize(header);
    const map = {
      'bezeichnung': 'name', 'name': 'name', 'betriebsmittel': 'name',
      'betriebsmittelart': 'assetType', 'art': 'assetType', 'typ': 'assetType',
      'anlagennummer': 'assetId', 'anlagen nummer': 'assetId', 'nummer': 'assetId', 'asset id': 'assetId',
      'bereich': 'area', 'standort': 'area',
      'hersteller': 'manufacturer',
      'modell': 'model',
      'seriennummer': 'serial', 'serial': 'serial',
      'wartungsintervall tage': 'interval', 'wartungsintervall': 'interval',
      'letzte wartung': 'lastMaintenance',
      'prufungen aktiv': 'inspectionEnabled', 'prufung aktiv': 'inspectionEnabled',
      'prufintervall tage': 'inspectionInterval', 'prufintervall': 'inspectionInterval',
      'letzte prufung': 'lastInspection',
      'nachste prufung': 'nextInspection',
      'notiz': 'notes', 'notizen': 'notes', 'bemerkung': 'notes'
    };
    return map[key] || null;
  }

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const semicolons = (firstLine.match(/;/g) || []).length;
    const commas = (firstLine.match(/,/g) || []).length;
    return semicolons >= commas ? ';' : ',';
  }

  function parseCsv(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const delimiter = detectDelimiter(source);
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (quoted) {
        if (char === '"') {
          if (source[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else {
            quoted = false;
          }
        } else {
          cell += char;
        }
        continue;
      }

      if (char === '"') {
        quoted = true;
      } else if (char === delimiter) {
        row.push(cell);
        cell = '';
      } else if (char === '\n') {
        row.push(cell.replace(/\r$/, ''));
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }

    if (cell.length || row.length) {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
    }
    return rows.filter(items => items.some(item => String(item).trim() !== ''));
  }

  function rowsFromCsv(text) {
    const table = parseCsv(text);
    if (table.length < 2) throw new Error('Die CSV-Datei enthält keine Datenzeilen.');

    const headers = table[0].map(headerKey);
    if (!headers.includes('name')) throw new Error('Die Spalte „Bezeichnung“ fehlt.');

    const rows = table.slice(1).map(values => {
      const result = {};
      headers.forEach((key, index) => {
        if (key) result[key] = String(values[index] ?? '').trim();
      });
      const rawType = result.assetType || 'Sonstiges Betriebsmittel';
      result.assetType = TYPE_MAP.get(normalize(rawType)) || 'other';
      return result;
    }).filter(row => Object.values(row).some(value => String(value || '').trim()));

    if (!rows.length) throw new Error('Die CSV-Datei enthält keine Betriebsmittel.');
    if (rows.length > MAX_ROWS) throw new Error(`Maximal ${MAX_ROWS} Betriebsmittel pro Import.`);
    return rows;
  }

  async function apiImport(rows, dryRun) {
    const response = await fetch('/api/account/import', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows, dryRun })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || 'Import fehlgeschlagen.');
    return data;
  }

  function sectionMarkup() {
    return `
      <section class="account-section import-v12-section" data-import-v12>
        <div class="account-section-head">
          <div>
            <strong>Betriebsmittel importieren</strong>
            <small>Bestehende Betriebsmittel werden nicht überschrieben. Vor dem Import zeigt QRPass eine Prüfung und Vorschau.</small>
          </div>
        </div>
        <div class="import-v12-actions">
          <button type="button" class="button" data-import-v12-action="template">CSV-Vorlage herunterladen</button>
          <button type="button" class="button button-primary" data-import-v12-action="choose">CSV auswählen</button>
          <input class="import-v12-file" type="file" accept=".csv,text/csv" data-import-v12-file>
        </div>
        <p class="import-v12-note">Maximal ${MAX_ROWS} Zeilen pro Import. Datumsformat: JJJJ-MM-TT. Unterstützte Arten: Maschine, Prüfpflichtige Anlage, Leiter / Tritt, Stapler / Flurförderzeug, Kran, Hebezeug, Anschlagmittel, Sonstiges Betriebsmittel.</p>
        <div data-import-v12-output></div>
      </section>`;
  }

  function inject() {
    const body = document.querySelector('.account-panel-body');
    if (!body || body.querySelector('[data-import-v12]')) return;
    const sections = [...body.querySelectorAll('.account-section')];
    const backup = sections.find(section => section.querySelector('.account-section-head strong')?.textContent.trim() === 'Datensicherung');
    if (backup) backup.insertAdjacentHTML('afterend', sectionMarkup());
    else body.insertAdjacentHTML('beforeend', sectionMarkup());
  }

  function issueMap(data) {
    return new Map((data?.issues || []).map(issue => [Number(issue.row), issue]));
  }

  function renderPreview(data) {
    previewData = data;
    const output = document.querySelector('[data-import-v12-output]');
    if (!output) return;
    const issues = issueMap(data);
    const visible = currentRows.slice(0, 12);
    output.innerHTML = `
      <div class="import-v12-summary">
        <div><span>Zeilen</span><strong>${data.total}</strong></div>
        <div><span>Gültig</span><strong>${data.valid}</strong></div>
        <div><span>Fehler</span><strong>${data.invalid}</strong></div>
      </div>
      <div class="import-v12-preview">
        <table>
          <thead><tr><th>Zeile</th><th>Bezeichnung</th><th>Nummer</th><th>Art</th><th>Status</th></tr></thead>
          <tbody>
            ${visible.map((row, index) => {
              const csvRow = index + 2;
              const issue = issues.get(csvRow);
              return `<tr>
                <td>${csvRow}</td>
                <td>${esc(row.name || '–')}</td>
                <td>${esc(row.assetId || '–')}</td>
                <td>${esc(TYPE_LABELS[row.assetType] || TYPE_LABELS.other)}</td>
                <td class="${issue ? 'import-v12-error' : 'import-v12-ok'}">${issue ? esc(issue.errors.join(' · ')) : 'Bereit'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${data.total > visible.length ? `<p class="import-v12-note">Vorschau zeigt die ersten ${visible.length} von ${data.total} Zeilen.</p>` : ''}
      <div class="import-v12-actions">
        <button type="button" class="button button-primary" data-import-v12-action="run" ${data.valid ? '' : 'disabled'}>${data.valid} gültige Betriebsmittel importieren</button>
        <button type="button" class="button" data-import-v12-action="reset">Andere Datei wählen</button>
      </div>
      <div class="import-v12-result" data-import-v12-result hidden></div>`;
  }

  function reset() {
    currentRows = [];
    previewData = null;
    const file = document.querySelector('[data-import-v12-file]');
    if (file) file.value = '';
    const output = document.querySelector('[data-import-v12-output]');
    if (output) output.innerHTML = '';
  }

  function downloadTemplate() {
    const headers = [
      'Bezeichnung','Betriebsmittelart','Anlagennummer','Bereich','Hersteller','Modell','Seriennummer',
      'Wartungsintervall Tage','Letzte Wartung','Prüfungen aktiv','Prüfintervall Tage','Letzte Prüfung','Nächste Prüfung','Notiz'
    ];
    const csv = `\uFEFF${headers.join(';')}\r\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'qrpass-import-vorlage.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function readFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      window.alert('Die CSV-Datei ist zu groß. Maximal 1 MB.');
      return;
    }
    const output = document.querySelector('[data-import-v12-output]');
    if (output) output.innerHTML = '<p class="import-v12-note">Datei wird geprüft …</p>';
    try {
      currentRows = rowsFromCsv(await file.text());
      const data = await apiImport(currentRows, true);
      renderPreview(data);
    } catch (error) {
      currentRows = [];
      previewData = null;
      if (output) output.innerHTML = `<div class="import-v12-result error">${esc(error.message)}</div>`;
    }
  }

  async function runImport(button) {
    if (!currentRows.length || !previewData?.valid) return;
    const confirmed = window.confirm(
      `${previewData.valid} Betriebsmittel importieren?\n\nVorhandene Betriebsmittel werden nicht überschrieben. Fehlerhafte oder inzwischen doppelte Zeilen werden übersprungen.`
    );
    if (!confirmed) return;

    button.disabled = true;
    const old = button.textContent;
    button.textContent = 'Import läuft …';
    try {
      const result = await apiImport(currentRows, false);
      if (typeof loadRemoteState === 'function') await loadRemoteState();
      if (typeof render === 'function') render();
      const resultBox = document.querySelector('[data-import-v12-result]');
      if (resultBox) {
        resultBox.hidden = false;
        resultBox.classList.remove('error');
        resultBox.textContent = `${result.imported} Betriebsmittel importiert${result.skipped ? ` · ${result.skipped} übersprungen` : ''}.`;
      }
      if (typeof toast === 'function') toast(`${result.imported} Betriebsmittel importiert`);
      currentRows = [];
      previewData = null;
    } catch (error) {
      const resultBox = document.querySelector('[data-import-v12-result]');
      if (resultBox) {
        resultBox.hidden = false;
        resultBox.classList.add('error');
        resultBox.textContent = error.message;
      } else {
        window.alert(error.message);
      }
      button.disabled = false;
      button.textContent = old;
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-import-v12-action]');
    if (!button) return;
    const action = button.dataset.importV12Action;
    if (action === 'template') downloadTemplate();
    if (action === 'choose') document.querySelector('[data-import-v12-file]')?.click();
    if (action === 'reset') {
      reset();
      document.querySelector('[data-import-v12-file]')?.click();
    }
    if (action === 'run') runImport(button);
  });

  document.addEventListener('change', event => {
    const input = event.target.closest('[data-import-v12-file]');
    if (input) readFile(input.files?.[0]);
  });

  const observer = new MutationObserver(inject);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('qrpass:auth', () => setTimeout(inject, 0));
  setTimeout(inject, 300);
})();
